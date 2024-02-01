export interface LWJSON {
  FixSuggestions?: FixSuggestion[]
}

export interface VersionEdge {
  Version: string
  Severity?: string
  CVE?: string
}

export interface VersionNode {
  Version: string
  Edges?: VersionEdge[]
}

export interface VersionGraphInfo {
  NodeCnt?: number
  EdgeCnt?: number
  ExtraAthenaCalls?: number
  VersionGraph?: VersionNode[]
}

export interface Recommendation {
  FixVersion: FixVersion
  Kind?: string
}

export interface Info {
  Recommendations?: Recommendation[]
  VersionGraphInfo?: VersionGraphInfo
}

export interface FixSuggestion {
  Id: string
  Info: Info
  AffectedArtifactId: string
}

export interface FixVersion {
  Type?: string
  Version?: string
}
