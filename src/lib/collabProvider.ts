import type { RealtimeChannel } from '@supabase/supabase-js';
import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { supabase } from './supabase';
import { base64ToBytes, bytesToBase64 } from './base64';

export type CollabStatus = 'connecting' | 'connected' | 'error' | 'closed';

/**
 * Live collaboration transport over a private Supabase Realtime channel.
 *
 * Wire protocol (all payloads base64):
 *   update    — incremental Yjs update; `to` targets one peer when replying
 *   sv        — a peer's state vector; receivers respond with the diff the
 *               sender is missing (and their own sv unless it's already a reply)
 *   awareness — y-protocols awareness update (cursors, names, colors)
 *
 * The channel only reaches online peers; durable convergence is handled by
 * the CRDT merge in sync.ts against the documents table.
 */
export class SupabaseCollabProvider {
  readonly awareness: Awareness;
  status: CollabStatus = 'connecting';

  private ydoc: Y.Doc;
  private channel: RealtimeChannel;
  private statusListeners = new Set<(s: CollabStatus) => void>();

  constructor(ydoc: Y.Doc, docId: string) {
    if (!supabase) throw new Error('Cloud sync is not configured');
    this.ydoc = ydoc;
    this.awareness = new Awareness(ydoc);

    this.channel = supabase.channel(`doc:${docId}`, {
      config: { private: true, broadcast: { self: false } },
    });

    this.channel
      .on('broadcast', { event: 'update' }, ({ payload }) => {
        if (payload.to !== undefined && payload.to !== this.ydoc.clientID) return;
        Y.applyUpdate(this.ydoc, base64ToBytes(payload.u), this);
      })
      .on('broadcast', { event: 'sv' }, ({ payload }) => {
        const theirSv = base64ToBytes(payload.sv);
        const diff = Y.encodeStateAsUpdate(this.ydoc, theirSv);
        if (diff.byteLength > 2) {
          this.send('update', { u: bytesToBase64(diff), to: payload.from });
        }
        if (!payload.reply) this.sendStateVector(true);
        this.broadcastAwareness([...this.awareness.getStates().keys()]);
      })
      .on('broadcast', { event: 'awareness' }, ({ payload }) => {
        applyAwarenessUpdate(this.awareness, base64ToBytes(payload.u), this);
      })
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') {
          this.setStatus('connected');
          this.sendStateVector(false);
          this.broadcastAwareness([this.ydoc.clientID]);
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
          this.setStatus('error');
        } else if (state === 'CLOSED') {
          this.setStatus('closed');
        }
      });

    this.ydoc.on('update', this.handleDocUpdate);
    this.awareness.on('update', this.handleAwarenessUpdate);
  }

  onStatus(fn: (s: CollabStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  destroy() {
    this.ydoc.off('update', this.handleDocUpdate);
    this.awareness.off('update', this.handleAwarenessUpdate);
    removeAwarenessStates(this.awareness, [this.ydoc.clientID], 'destroy');
    this.awareness.destroy();
    supabase?.removeChannel(this.channel);
    this.setStatus('closed');
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    this.send('update', { u: bytesToBase64(update) });
  };

  private handleAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this) return;
    this.broadcastAwareness(added.concat(updated, removed));
  };

  private broadcastAwareness(clients: number[]) {
    if (clients.length === 0) return;
    this.send('awareness', {
      u: bytesToBase64(encodeAwarenessUpdate(this.awareness, clients)),
    });
  }

  private sendStateVector(isReply: boolean) {
    this.send('sv', {
      sv: bytesToBase64(Y.encodeStateVector(this.ydoc)),
      from: this.ydoc.clientID,
      reply: isReply,
    });
  }

  private send(event: string, payload: Record<string, unknown>) {
    if (this.status !== 'connected' && event !== 'sv') return;
    this.channel.send({ type: 'broadcast', event, payload });
  }

  private setStatus(s: CollabStatus) {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((fn) => fn(s));
  }
}
