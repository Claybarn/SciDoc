# SciDoc

A scientific writing app where every document carries its own references. Write in a clean rich-text editor, pull citations straight from PubMed or CrossRef, and never maintain a separate citation library file again.

## Why

Traditional citation managers force you to maintain a global library that lives apart from your writing. SciDoc inverts that: each document is a **self-contained bundle** of prose + references. Export a document and everything travels with it in a single `.scidoc.json` file.

## Features

- **Rich text editing** — headings, lists, blockquotes, code, undo/redo (TipTap/ProseMirror under the hood)
- **Citation search** — query PubMed (NCBI E-utilities) or CrossRef by title, author, keywords; paste a DOI or PMID to resolve it directly
- **Per-document bundles** — references are stored inside the document itself; no shared library
- **Live in-text citations** — insert citation chips at the cursor; numbering updates automatically as you edit
- **Two citation styles** — numeric (Vancouver-style) or author–year (APA-style), switchable per document
- **Auto-generated bibliography** — rendered at the end of the document, ordered by first appearance (numeric) or alphabetically (author–year)
- **Equations** — inline and display LaTeX rendered with KaTeX; click any equation to edit it, with live preview and error checking. Equations are structural nodes, so they never conflict with citation processing
- **Word export** — generates a real `.docx` (headings, formatting, lists, citations, bibliography); equations are exported as LaTeX source since Word has no portable LaTeX renderer
- **PDF export** — via the browser's print dialog with a clean print stylesheet (chrome hidden, citations and KaTeX render properly)
- **Export / import** — one self-contained `.scidoc.json` file per document
- **Local-first** — documents persist in browser localStorage; no account, no server

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Usage

1. Create a document and start writing.
2. In the right-hand panel, search PubMed or CrossRef (or paste a DOI/PMID).
3. Click the quote icon to add a result to the document's bundle **and** cite it at the cursor, or the plus icon to just add it to the bundle.
4. The bibliography builds itself at the bottom of the page.
5. Use **Export** to download the whole document — text and references — as one file.

## Tech

- React 19 + TypeScript + Vite
- TipTap 3 (ProseMirror) with a custom inline citation node
- CrossRef REST API and NCBI E-utilities (both free, no API key required)
