// Document registry: a small JSON file listing the ingested documents and their
// metadata. Chunks live in Qdrant; this is only the "table of contents" for the UI.
// For multi-instance deployments replace this class with a database table.
import fs from 'node:fs/promises';
import path from 'node:path';

export class DocumentRegistry {
  constructor(storageDir) {
    this.file = path.join(storageDir, 'documents.json');
    this.documents = null;
    this.queue = Promise.resolve();
  }

  async load() {
    if (this.documents) return this.documents;
    try {
      this.documents = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch {
      this.documents = {};
    }
    return this.documents;
  }

  /** Writes are queued and go through a temp file so a crash cannot corrupt the registry. */
  save() {
    this.queue = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.documents, null, 2));
      await fs.rename(tmp, this.file);
    });
    return this.queue;
  }

  async list() {
    return Object.values(await this.load()).sort((a, b) => a.fileName.localeCompare(b.fileName));
  }

  async get(docId) {
    return (await this.load())[docId] || null;
  }

  async put(document) {
    (await this.load())[document.docId] = document;
    await this.save();
  }

  async remove(docId) {
    const documents = await this.load();
    if (!documents[docId]) return false;
    delete documents[docId];
    await this.save();
    return true;
  }
}
