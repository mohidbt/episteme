"use client";

import { useEffect, useState } from "react";
import { SIGN_UP_HREF } from "./cta";

/**
 * The only client JS on the landing page. A "Sign up free" button that fades in
 * once the visitor scrolls past the hero. No navbar otherwise.
 */
export function StickyCta() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <a
      href={SIGN_UP_HREF}
      className={`mk-sticky-cta mk-btn mk-btn-primary${show ? " show" : ""}`}
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
    >
      Sign up free
    </a>
  );
}
