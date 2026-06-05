const ICON_SRC = "/agent-icon.png";

export default function AgentIcon({ size = "md", className = "", rounded = "lg" }) {
  const sizeClass =
    size === "xs"
      ? "h-6 w-6"
      : size === "sm"
        ? "h-7 w-7"
        : size === "lg"
          ? "h-11 w-11"
          : "h-9 w-9";
  const radiusClass =
    rounded === "full" ? "rounded-full" : rounded === "md" ? "rounded-md" : "rounded-lg";

  return (
    <div
      className={`${sizeClass} ${radiusClass} shrink-0 overflow-hidden bg-bitget-panel ring-1 ring-bitget-border/60 ${className}`}
    >
      <img
        src={ICON_SRC}
        alt="逆天 Agent"
        className="h-full w-full object-cover object-[center_20%]"
        draggable={false}
      />
    </div>
  );
}

export { ICON_SRC as AGENT_ICON_SRC };
