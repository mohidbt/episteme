import { OPEN_APP_HREF, SIGN_UP_HREF } from "./cta";

export function CtaRow() {
  return (
    <div className="mk-cta-row">
      <a href={SIGN_UP_HREF} className="mk-btn mk-btn-primary mk-btn-lg">
        Sign up free
      </a>
      <a href={OPEN_APP_HREF} className="mk-btn mk-btn-ghost mk-btn-lg">
        Launch App
      </a>
    </div>
  );
}
