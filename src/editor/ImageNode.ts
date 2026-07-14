import Image from '@tiptap/extension-image';

/**
 * The stock TipTap image node, extended with intrinsic width/height attributes
 * so exports (e.g. DOCX) can size images without decoding them again.
 */
export const ImageNode = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null },
      height: { default: null },
    };
  },
}).configure({ allowBase64: true });
