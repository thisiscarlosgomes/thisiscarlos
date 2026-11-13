/** A lightweight inline illustration; CSS pauses movement for reduced motion. */
export function AnimatedBot() {
  return (
    <span style={{ display: "inline-flex", width: "1em", height: "1em", verticalAlign: "-.12em", lineHeight: 1 }} className="inline-bot" role="img" aria-label="Black bot with blinking white eyes">
      <svg style={{ display: "block", width: "100%", height: "100%", overflow: "visible" }} width="1em" height="1em" viewBox="0 0 116 108" aria-hidden="true">
        <path d="M58 4C30 4 7 26 3 51c-5 30 17 51 51 53 32 2 59-16 59-44C113 29 89 4 58 4Z" fill="#18181b" />
        <g className="bot-gaze">
          <g className="bot-eyes" fill="white">
            <rect x="45" y="43" width="13" height="30" rx="6.5" />
            <rect x="75" y="43" width="13" height="30" rx="6.5" />
          </g>
        </g>
      </svg>
    </span>
  );
}
