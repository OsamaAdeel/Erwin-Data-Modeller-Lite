export function serializeDoc(doc: XMLDocument): string {
  let xml = new XMLSerializer().serializeToString(doc);
  if (!xml.startsWith("<?xml")) {
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
  }
  return xml;
}

export function outputFilename(input: string): string {
  const m = input.match(/^(.*_[Vv])(\d+)\.xml$/i);
  if (m) {
    const prefix = m[1];
    const num = m[2];
    const nextNum = (parseInt(num, 10) + 1).toString();
    const padded =
      nextNum.length < num.length ? nextNum.padStart(num.length, "0") : nextNum;
    return `${prefix}${padded}.xml`;
  }
  return `updated_${input}`;
}
