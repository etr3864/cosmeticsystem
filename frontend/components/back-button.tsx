import { ChevronRight } from "lucide-react";

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="drawer-back">
      <ChevronRight size={18} strokeWidth={2.25} />
      חזרה
    </button>
  );
}
