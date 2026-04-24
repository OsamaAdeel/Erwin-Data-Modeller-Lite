export type Variant = "erwin-dm-v9" | "erwin-classic" | "unknown";

export type DataType =
  | "VARCHAR2"
  | "NUMBER"
  | "DATE"
  | "TIMESTAMP"
  | "CHAR"
  | "CLOB"
  | "BLOB";

export interface NewColumnSpec {
  id: string;
  name: string;
  type: DataType;
  size: string;
  scale: string;
  nullable: boolean;
  pk: boolean;
}

export interface ParsedDoc {
  fileName: string;
  doc: XMLDocument;
  variant: Variant;
  entityDict: Map<string, string>;  // UPPER -> original case
  domainMap: Map<string, string>;   // domain name -> id (DM-v9 only)
}
