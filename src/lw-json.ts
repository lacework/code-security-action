export interface LWJSON {
  FixSuggestions?: FixSuggestion[]
}

export interface FixVersion {
  type: string
  version: string
}

export interface Info {
  fixVersion: FixVersion
  diffs: string[][]
}
export interface FixSuggestion {
  fixId: string
  info: Info
}
