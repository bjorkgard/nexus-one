import { Html } from "@react-three/drei";
import { useEffect } from "react";
import { TOKENS } from "../shared/tokens";
import { useRevealHold } from "../world/reveal-hold";

// One HTML line at the board origin. Releases the Stage reveal hold (idempotent) so a failed board never blocks the reveal (Q3).
export function PaletteFailure({ message }: { message: string }) {
  const { release } = useRevealHold();
  useEffect(() => {
    release();
  }, [release]);
  return (
    <Html position={[0, 2, 0]} center zIndexRange={[10, 0]}>
      <div
        data-testid="palette-failure"
        style={{
          color: TOKENS.danger,
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {message}
      </div>
    </Html>
  );
}
