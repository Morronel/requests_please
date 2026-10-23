export type Difficulty = 'easy' | 'medium' | 'hard';

export type AttackClass =
  | 'sqli'
  | 'xss'
  | 'traversal'
  | 'scanner'
  | 'cmdi'
  | 'ssrf'
  | 'stuffing'
  | 'redirect'
  | 'ssti'
  | 'log4shell'
  | 'xxe'
  | 'jwt'
  | 'smuggling'
  | 'policy';

export type Encoding = 'url' | 'base64' | 'html' | 'hex';

export type FieldKind = 'method' | 'path' | 'query' | 'header' | 'body' | 'ip';

/** One tappable value in a request. `raw` is what's on the wire, `plain` is fully decoded. */
export interface Field {
  id: string;
  kind: FieldKind;
  key?: string;
  raw: string;
  plain: string;
  /** Encodings applied to `plain`, innermost first. */
  layers: Encoding[];
}

export type Reputation = 'clean' | 'unknown' | 'suspicious' | 'malicious' | 'tor';

export interface IpInfo {
  asn: string;
  country: string;
  reputation: Reputation;
  seen: number;
  internal: boolean;
}

export interface Truth {
  malicious: boolean;
  cls?: AttackClass;
  bait?: boolean;
  /** Endpoint the attack targets, used for patches. */
  endpoint?: string;
  /** Shown in the feedback after the verdict. */
  explain: string;
  /** Set when the target endpoint was patched, so allowing is safe. */
  harmless?: boolean;
}

export interface HttpRequest {
  id: string;
  method: Field;
  path: Field;
  query: Field[];
  headers: Field[];
  body?: Field;
  ip: Field;
  ipInfo: IpInfo;
  /** Requests per second from this IP over the last 12 ticks. */
  rate: number[];
  note?: string;
  truth: Truth;
}

export type Verdict = 'allow' | 'block';

export type RuleTarget = 'path' | 'query' | 'header' | 'body' | 'ua' | 'ip' | 'rate';
export type RuleOp = 'contains' | 'startsWith' | 'equals' | 'rateAbove';

export interface Rule {
  id: string;
  target: RuleTarget;
  op: RuleOp;
  value: string;
  caught: number;
  collateral: number;
}

export type Speaker = 'chad' | 'ciso' | 'intern' | 'system' | 'pentest';

export interface ChatPing {
  id: number;
  who: Speaker;
  text: string;
}
