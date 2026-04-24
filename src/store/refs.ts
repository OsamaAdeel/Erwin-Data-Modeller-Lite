// Ref store for artifacts that can't safely live in Redux state.
//
// XMLDocument instances are mutated in place by the emitter
// (addEntityClassic / addEntityDMv9). Immer's auto-freeze would break that
// on the second generate call, so the Document is kept here and the slice
// only tracks a parseId.

const docs = new Map<string, XMLDocument>();

export function makeParseId(): string {
  return crypto.randomUUID();
}

export function setParsedDoc(id: string, doc: XMLDocument): void {
  docs.set(id, doc);
}

export function getParsedDoc(id: string): XMLDocument | undefined {
  return docs.get(id);
}

export function deleteParsedDoc(id: string): void {
  docs.delete(id);
}
