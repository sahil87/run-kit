const BORDER_SEGMENTS = [
  { points: "44,11.2 56,32 47.5,32 39.5,17.2", staticFill: "#b4b4b4" },
  { points: "56,32 44,52.8 39.5,46.8 47.5,32", staticFill: "#b4b4b4" },
  { points: "44,52.8 20,52.8 24.5,46.8 39.5,46.8", staticFill: "#2a2a2a" },
  { points: "20,52.8 8,32 16.5,32 24.5,46.8", staticFill: "#2a2a2a" },
  { points: "8,32 20,11.2 24.5,17.2 16.5,32", staticFill: "#2a2a2a" },
  { points: "20,11.2 44,11.2 39.5,17.2 24.5,17.2", staticFill: "#b4b4b4" },
];

const INNER_FACES = [
  { points: "24.5,17.2 39.5,17.2 47.5,32 32,32", fill: "#888888" },
  { points: "47.5,32 39.5,46.8 24.5,46.8 32,32", fill: "#737373" },
  { points: "24.5,46.8 16.5,32 24.5,17.2 32,32", fill: "#545454" },
];

const ANIM_FILL = "#b4b4b4";

export function LogoSpinner({
  size = 16,
  loading = true,
}: {
  size?: number;
  loading?: boolean;
}) {
  return (
    <svg
      viewBox="7 10 50 44"
      width={size}
      height={size}
      aria-hidden="true"
      role="img"
    >
      {BORDER_SEGMENTS.map((seg, i) => (
        <polygon
          key={i}
          points={seg.points}
          fill={loading ? ANIM_FILL : seg.staticFill}
          style={{
            animation: loading
              ? `logo-chase 1.2s ease-in-out ${i * 0.2}s infinite`
              : "none",
            transition: loading ? "none" : "opacity 0.5s ease-out, fill 0.5s ease-out",
            opacity: loading ? undefined : 1,
          }}
        />
      ))}
      {INNER_FACES.map((face, i) => (
        <polygon key={`face-${i}`} points={face.points} fill={face.fill} />
      ))}
    </svg>
  );
}
