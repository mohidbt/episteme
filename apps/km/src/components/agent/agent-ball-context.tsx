"use client";

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";

interface AgentBallState {
  open: boolean;
}

interface AgentBallContextValue extends AgentBallState {
  openWithPrompt: (prompt: string, skill?: string) => void;
  close: () => void;
  consumeInitialPrompt: () => { prompt: string | null; skill: string | null };
}

const AgentBallContext = createContext<AgentBallContextValue | null>(null);

export function AgentBallProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AgentBallState>({ open: false });
  const initialPromptRef = useRef<string | null>(null);
  const initialSkillRef = useRef<string | null>(null);

  const openWithPrompt = useCallback((prompt: string, skill?: string) => {
    initialPromptRef.current = prompt || null;
    initialSkillRef.current = skill || null;
    setState({ open: true });
  }, []);

  const close = useCallback(() => {
    initialPromptRef.current = null;
    initialSkillRef.current = null;
    setState({ open: false });
  }, []);

  const consumeInitialPrompt = useCallback(() => {
    const prompt = initialPromptRef.current;
    const skill = initialSkillRef.current;
    initialPromptRef.current = null;
    initialSkillRef.current = null;
    return { prompt, skill };
  }, []);

  return (
    <AgentBallContext.Provider value={{ ...state, openWithPrompt, close, consumeInitialPrompt }}>
      {children}
    </AgentBallContext.Provider>
  );
}

export function useAgentBall(): AgentBallContextValue {
  const ctx = useContext(AgentBallContext);
  if (!ctx) throw new Error("useAgentBall must be used within <AgentBallProvider>");
  return ctx;
}