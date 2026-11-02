"use client";
import { Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function UndoRedo({ onUndo, onRedo, canUndo, canRedo }: { onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean }) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Undo and redo">
      <Button type="button" variant="outline" size="lg" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        <Undo2 aria-hidden="true" />Undo
      </Button>
      <Button type="button" variant="outline" size="lg" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
        <Redo2 aria-hidden="true" />Redo
      </Button>
    </div>
  );
}
