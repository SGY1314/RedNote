/** Decorative local artwork; no external media requests. */
export default function LoginStory({ admin = false }: { admin?: boolean }) {
  return <section className="login-story">
    <div className="login-brand"><span><strong>RedNote<span className="brand-period">.</span></strong><small>内容创作工作台</small></span></div>
    {!admin && <>
      <div className="login-story-copy"><h1>让灵感<br />成为自己的内容。</h1><p>收集灵感，创作表达，轻松发布。</p></div>
      <svg className="login-artwork" viewBox="0 0 400 430" aria-hidden="true">
        <defs><clipPath id="login-window"><path d="M60 430V170a140 140 0 0 1 280 0v260Z" /></clipPath></defs>
        <g clipPath="url(#login-window)">
          <path fill="#b7b6a2" d="M0 0h400v430H0z" /><path fill="#d8dcc8" d="M87 0h126v278H87z" />
          <path fill="none" stroke="#ecead9" strokeWidth="9" d="M142 0v278M87 175h126" />
          <path fill="#9e8769" d="m0 340 400-80v170H0z" /><path fill="#c0a17c" d="m66 350 252-43 60 103-251 35z" />
          <path fill="#e4dac1" d="m204 337 80-13 39 73-82 17z" /><path stroke="#a2977e" strokeWidth="2" d="m219 348 55-10m-49 22 55-10m-48 22 55-10" />
          <ellipse fill="#d9d1ba" cx="171" cy="379" rx="67" ry="18" /><path fill="none" stroke="#f0e8d6" strokeWidth="12" d="M201 333c45-6 45 40 4 36" />
          <path fill="#f0e8d6" d="m126 331 9 40c6 23 62 23 68 0l7-40z" /><ellipse fill="#d4c2a1" cx="169" cy="331" rx="43" ry="18" /><ellipse fill="#95704e" cx="169" cy="331" rx="35" ry="12" />
          <path fill="none" stroke="#71836a" strokeWidth="4" d="M292 309V200" /><path fill="#71836a" d="M292 238c-61-57-67 4-2 15m2-39c56-60 66-5 2 11m-2 53c-58-43-63 12 0 12" /><path fill="#b5a180" d="M266 298h53l-8 43h-37z" />
        </g>
      </svg>
    </>}
  </section>;
}
