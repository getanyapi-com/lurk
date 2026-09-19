"use client";

import { createContext, useContext, useMemo, useState } from "react";

/** What the list already knows about a row, which is enough to open it with. */
export type OpeningSummary = {
  id: string;
  title: string;
  author: string | null;
  avatarUrl: string | null;
  subreddit: string;
  subredditIconUrl: string | null;
  createdAt: Date;
  /** The row's own rating: a score for a lead, a verdict for a held item. */
  trailing: React.ReactNode;
};

type Opening = {
  /** The row being opened, until the server agrees it is the one on screen. */
  summary: OpeningSummary | null;
  open: (summary: OpeningSummary) => void;
  /**
   * Whether the reader has gone back to the list. Only a phone asks: there the
   * thread covers the list, and leaving it cannot wait a second for the server.
   */
  closed: boolean;
  close: () => void;
};

const OpeningContext = createContext<Opening>({
  summary: null,
  open: () => {},
  closed: false,
  close: () => {},
});

export function useOpening(): Opening {
  return useContext(OpeningContext);
}

/**
 * Who the workspace is showing, as far as the person clicking is concerned.
 *
 * Which row is selected is decided on the server, and reading a lead takes
 * about a second, so a click used to change nothing at all until that second
 * was up. This holds the row you just clicked and lets the list and the pane
 * act on it at once; the server's answer replaces it when it lands.
 */
export function OpeningProvider({
  serverSelectedId,
  children,
}: {
  serverSelectedId: string | null;
  children: React.ReactNode;
}) {
  const [clicked, setClicked] = useState<OpeningSummary | null>(null);
  const [closed, setClosed] = useState(false);
  /**
   * Derived rather than cleared, so there is no moment where the pane has both
   * the server's answer and something standing in for it: the row we are
   * waiting on is whatever was clicked that the server has not caught up to.
   */
  const summary = clicked && clicked.id !== serverSelectedId ? clicked : null;

  const value = useMemo<Opening>(
    () => ({
      summary,
      open: (row) => {
        setClicked(row);
        setClosed(false);
      },
      closed,
      close: () => setClosed(true),
    }),
    [summary, closed],
  );

  return <OpeningContext value={value}>{children}</OpeningContext>;
}
