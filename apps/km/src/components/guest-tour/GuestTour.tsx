"use client";

import { useEffect, useState } from "react";
import { Joyride, STATUS, type EventData, type Controls, type Step } from "react-joyride";
import { getTourDone, setTourDone } from "@/lib/guest-tour/tour-state";

const STEPS: Step[] = [];

export function GuestTour({ isAnonymous }: { isAnonymous: boolean }) {
  const [run, setRun] = useState(false);

  useEffect(() => {
    if (isAnonymous && !getTourDone()) setRun(true);
  }, [isAnonymous]);

  function handleEvent(data: EventData, _controls: Controls) {
    const status = data.status as string;
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setTourDone();
      setRun(false);
    }
  }

  return (
    <Joyride
      run={run}
      steps={STEPS}
      continuous
      options={{ buttons: ["back", "skip", "primary"], showProgress: true }}
      onEvent={handleEvent}
    />
  );
}
