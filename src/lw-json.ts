export interface LWJSON {
  FixSuggestions?: FixSuggestion[]
}

export interface NextNode {
  Version: string
  Severity?: string
  CVE?: string
}

export interface SortedVersionGraphNode {
  Version: string
  Edges?: NextNode[]
}

export interface VersionGraphStruct {
  NodeCnt?: number
  EdgeCnt?: number
  ExtraAthenaCalls?: number
  VersionGraph?: NextNode[]
}

export interface FixInfo {
  FixVersion: FixVersion
  Kind?: string
}

export interface FixSuggestionInfo {
  Recommendations?: FixInfo[]
  VersionGraphInfo?: VersionGraphStruct
}

export interface FixSuggestion {
  Id: string
  Info: FixSuggestionInfo
  AffectedArtifactId: string
}

export interface FixVersion {
  Type?: string
  Version?: string
}
