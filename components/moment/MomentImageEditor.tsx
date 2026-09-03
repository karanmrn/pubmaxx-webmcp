"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import MomentPhotoDecorator from "@/components/moment/MomentPhotoDecorator";
import ProfileImageCropper from "@/components/profile/ProfileImageCropper";
import type { CropTarget } from "@/lib/profileImagePicker";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";

type MomentImageEditorProps = {
  file: File;
  openerRef: RefObject<HTMLElement | null>;
  onSave: (result: { blob: Blob }) => void;
  onCancel: () => void;
  onError: (reason?: "open" | "save") => void;
};

const MOMENT_PHOTO_CROP: CropTarget = {
  id: "moment-photo",
  aspectRatio: 4 / 5,
  outputBox: { width: 1200, height: 1500 },
  nounLower: "moment photo",
  fileName: "moment-photo.jpg",
};

export default function MomentImageEditor({
  file,
  openerRef,
  onSave,
  onCancel,
  onError,
}: MomentImageEditorProps): React.JSX.Element {
  const sheetRef = useRef<HTMLElement | null>(null);
  const [croppedFile, setCroppedFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useFocusTrap(true, sheetRef, "strict-modal", openerRef);
  useDismissOnEscape(!saving, onCancel);
  useEffect(() => {
    sheetRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="momentEditorBackdrop">
      <section
        className="momentEditorSheet"
        role="dialog"
        aria-modal="true"
        aria-label="Edit photo"
        aria-labelledby="moment-editor-title"
        ref={sheetRef}
        tabIndex={-1}
      >
        <header className="momentEditorHeader">
          <h2 id="moment-editor-title">Edit photo</h2>
          <button type="button" className="momentEditorClose" disabled={saving} onClick={onCancel} aria-label="Close editor">
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="momentEditorTools" aria-label="Photo editor tools">
          <span aria-current={croppedFile ? undefined : "step"}>Crop</span>
          <span aria-current={croppedFile ? "step" : undefined}>Filter</span>
          <span>Text</span>
          <span>Draw</span>
        </div>
        <div className="momentEditorCanvas">
          {croppedFile ? (
            <MomentPhotoDecorator
              file={croppedFile}
              onBack={() => setCroppedFile(null)}
              onCancel={onCancel}
              onSave={(blob) => onSave({ blob })}
              onError={onError}
              onSavingChange={setSaving}
            />
          ) : (
            <ProfileImageCropper
              target={MOMENT_PHOTO_CROP}
              file={file}
              busy={saving}
              busyLabel="Preparing…"
              onCropped={setCroppedFile}
              onCancel={onCancel}
              onBusyChange={setSaving}
            />
          )}
        </div>
      </section>
    </div>
  );
}
