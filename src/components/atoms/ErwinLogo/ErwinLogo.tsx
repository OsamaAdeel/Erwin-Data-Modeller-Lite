export interface ErwinLogoProps {
  width?: number;
  color?: string;
  className?: string;
  title?: string;
}

export default function ErwinLogo({
  width = 300,
  color = "#FFFFFF",
  className = "",
  title = "erwin",
}: ErwinLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 360 120"
      width={width}
      className={className}
      fill={color}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>

      {/* Base text for "erw" */}
      <text
        x="10"
        y="100"
        fontFamily="Century Gothic, Futura, sans-serif"
        fontSize="95"
        letterSpacing="-2"
      >
        erw
      </text>

      {/* Stem of the 'i' */}
      <rect x="238" y="45" width="10" height="55" />

      {/* Special square dot of the 'i' */}
      <rect x="235" y="24" width="15" height="14" />

      {/* Beam/triangle shape extending from the 'i' */}
      <polygon points="255,29 345,14 345,40" />

      {/* The letter 'n' — sits flush against the 'i' stem */}
      <text
        x="248"
        y="100"
        fontFamily="Century Gothic, Futura, sans-serif"
        fontSize="95"
        letterSpacing="-2"
      >
        n
      </text>

      {/* Registered trademark — pulled in to sit above the 'n' */}
      <text x="308" y="65" fontFamily="sans-serif" fontSize="18">
        ®
      </text>
    </svg>
  );
}
