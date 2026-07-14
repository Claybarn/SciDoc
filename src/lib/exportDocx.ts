import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import type { JSONContent } from '@tiptap/core';
import type { Citation, CitationStyle, SciDocument } from '../types';
import { bibliographyEntry, citationOrderFromContent, inTextLabel } from './format';

interface Marks {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
  underline?: boolean;
  link?: string;
}

function marksFrom(node: JSONContent): Marks {
  const m: Marks = {};
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') m.bold = true;
    if (mark.type === 'italic') m.italics = true;
    if (mark.type === 'strike') m.strike = true;
    if (mark.type === 'code') m.code = true;
    if (mark.type === 'underline') m.underline = true;
    if (mark.type === 'link') m.link = mark.attrs?.href as string;
  }
  return m;
}

function run(text: string, m: Marks = {}): TextRun {
  return new TextRun({
    text,
    bold: m.bold,
    italics: m.italics,
    strike: m.strike,
    underline: m.underline ? {} : undefined,
    font: m.code ? 'Courier New' : undefined,
    shading: m.code ? { fill: 'F0F1F5' } : undefined,
  });
}

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const;

/** Usable page width in pixels for embedded images (6.5in at 96dpi). */
const MAX_IMAGE_WIDTH = 624;

function dataUrlToImage(src: string): { data: Uint8Array; type: 'jpg' | 'png' | 'gif' | 'bmp' } | null {
  const m = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/.exec(src);
  if (!m) return null;
  const type = m[1] === 'jpeg' || m[1] === 'jpg' ? 'jpg' : (m[1] as 'png' | 'gif' | 'bmp');
  const bin = atob(m[2]);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  return { data, type };
}

function imageParagraph(node: JSONContent): Paragraph {
  const src = (node.attrs?.src as string) ?? '';
  const parsed = dataUrlToImage(src);
  if (!parsed) {
    // External or unsupported source; leave a readable placeholder.
    return new Paragraph({
      children: [run(src ? `[image: ${src}]` : '[image]', { italics: true })],
      spacing: { after: 160 },
    });
  }
  const width = (node.attrs?.width as number) || 480;
  const height = (node.attrs?.height as number) || 360;
  const scale = Math.min(1, MAX_IMAGE_WIDTH / width);
  return new Paragraph({
    children: [
      new ImageRun({
        type: parsed.type,
        data: parsed.data,
        transformation: {
          width: Math.round(width * scale),
          height: Math.round(height * scale),
        },
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: 160, after: 160 },
  });
}

interface Ctx {
  citations: Record<string, Citation>;
  order: string[];
  style: CitationStyle;
}

function citationLabel(id: string, ctx: Ctx): string {
  const c = ctx.citations[id];
  if (!c) return '[?]';
  if (ctx.style === 'numeric') {
    const n = ctx.order.indexOf(id);
    return n === -1 ? '[?]' : `[${n + 1}]`;
  }
  return `(${inTextLabel(c)})`;
}

/** Convert the inline children of a node to docx runs. */
function inlineChildren(node: JSONContent, ctx: Ctx): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];
  for (const child of node.content ?? []) {
    if (child.type === 'text') {
      const m = marksFrom(child);
      if (m.link) {
        out.push(
          new ExternalHyperlink({
            link: m.link,
            children: [new TextRun({ text: child.text ?? '', style: 'Hyperlink' })],
          }),
        );
      } else {
        out.push(run(child.text ?? '', m));
      }
    } else if (child.type === 'citation') {
      out.push(run(citationLabel(child.attrs?.citationId as string, ctx)));
    } else if (child.type === 'inlineMath') {
      // Word has no portable LaTeX renderer; export the source between $…$.
      out.push(run(`$${child.attrs?.latex ?? ''}$`, { italics: true }));
    } else if (child.type === 'hardBreak') {
      out.push(new TextRun({ break: 1 }));
    }
  }
  return out;
}

function walkBlocks(
  nodes: JSONContent[],
  ctx: Ctx,
  paragraphs: Paragraph[],
  opts: { listRef?: 'bullets' | 'numbers'; listLevel?: number; quote?: boolean } = {},
) {
  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph': {
        paragraphs.push(
          new Paragraph({
            children: inlineChildren(node, ctx),
            style: opts.quote ? 'Quote' : undefined,
            bullet: opts.listRef === 'bullets' ? { level: opts.listLevel ?? 0 } : undefined,
            numbering:
              opts.listRef === 'numbers'
                ? { reference: 'scidoc-numbered', level: opts.listLevel ?? 0 }
                : undefined,
            spacing: { after: 160 },
          }),
        );
        break;
      }
      case 'heading': {
        const level = Math.min(Math.max((node.attrs?.level as number) ?? 1, 1), 3);
        paragraphs.push(
          new Paragraph({
            children: inlineChildren(node, ctx),
            heading: HEADINGS[level - 1],
            spacing: { before: 280, after: 140 },
          }),
        );
        break;
      }
      case 'blockquote':
        walkBlocks(node.content ?? [], ctx, paragraphs, { ...opts, quote: true });
        break;
      case 'bulletList':
      case 'orderedList': {
        const listRef = node.type === 'bulletList' ? 'bullets' : 'numbers';
        const level = opts.listRef ? (opts.listLevel ?? 0) + 1 : 0;
        for (const item of node.content ?? []) {
          walkBlocks(item.content ?? [], ctx, paragraphs, { ...opts, listRef, listLevel: level });
        }
        break;
      }
      case 'codeBlock': {
        const text = (node.content ?? []).map((c) => c.text ?? '').join('');
        for (const line of text.split('\n')) {
          paragraphs.push(
            new Paragraph({
              children: [run(line, { code: true })],
              spacing: { after: 40 },
            }),
          );
        }
        break;
      }
      case 'blockMath': {
        paragraphs.push(
          new Paragraph({
            children: [run(`$$${node.attrs?.latex ?? ''}$$`, { italics: true })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 160, after: 160 },
          }),
        );
        break;
      }
      case 'horizontalRule':
        paragraphs.push(new Paragraph({ text: '⸻', alignment: AlignmentType.CENTER }));
        break;
      case 'image':
        paragraphs.push(imageParagraph(node));
        break;
      default:
        if (node.content) walkBlocks(node.content, ctx, paragraphs, opts);
    }
  }
}

export async function exportDocx(doc: SciDocument): Promise<void> {
  const order = citationOrderFromContent(doc.content);
  const ctx: Ctx = { citations: doc.citations, order, style: doc.citationStyle };

  const paragraphs: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: doc.title || 'Untitled document', bold: true, size: 48 })],
      spacing: { after: 320 },
    }),
  ];
  walkBlocks((doc.content.content ?? []) as JSONContent[], ctx, paragraphs);

  // Bibliography
  const cited = order.map((id) => doc.citations[id]).filter(Boolean);
  if (cited.length > 0) {
    const entries =
      doc.citationStyle === 'author-year'
        ? [...cited].sort((a, b) =>
            (a.authors[0]?.family ?? a.title).localeCompare(b.authors[0]?.family ?? b.title),
          )
        : cited;
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: 'References', bold: true, size: 32 })],
        spacing: { before: 480, after: 200 },
      }),
    );
    entries.forEach((c, i) => {
      const prefix = doc.citationStyle === 'numeric' ? `${i + 1}. ` : '';
      paragraphs.push(
        new Paragraph({
          children: [run(prefix + bibliographyEntry(c, doc.citationStyle))],
          spacing: { after: 120 },
        }),
      );
    });
  }

  const file = new Document({
    numbering: {
      config: [
        {
          reference: 'scidoc-numbered',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    styles: {
      default: {
        document: { run: { font: 'Georgia', size: 23 } },
      },
    },
    sections: [{ children: paragraphs }],
  });

  const blob = await Packer.toBlob(file);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.title.replace(/[^\w\s-]/g, '').trim() || 'document'}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}
