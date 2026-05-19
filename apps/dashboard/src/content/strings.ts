// All user-visible strings live here so a single lint pass covers them.
// No marketing copy, no buzzwords, no emoji decoration.
export const strings = {
  appName: "KansoState",
  appTagline: "Real-time meeting state synchronization",

  nav: {
    meetings: "Meetings",
    signOut: "Sign out",
    signIn: "Sign in",
  },

  meetings: {
    title: "Meetings",
    empty: "No meetings found.",
    loading: "Loading...",
    join: "View",
  },

  meeting: {
    consensus: "Consensus",
    speakers: "Speakers",
    timeline: "Timeline",
    bridge: "Context notes",
    stale: "Consensus estimate (embedder unavailable)",
    live: "Live",
    ended: "Ended",
  },

  errors: {
    loadFailed: "Failed to load meeting data.",
    streamDisconnected: "Stream disconnected. Reconnecting…",
    unauthorized: "You are not authorized to view this meeting.",
  },
} as const;
