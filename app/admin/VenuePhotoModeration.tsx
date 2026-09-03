"use client";

// The moderator's two lanes for pub photo walls, lifted out of AdminClient.
//
// It is its own component because a report queue and a hidden lane are the same
// card twice, and because the console it came from is one function that every
// new lane makes harder to read. Nothing here decides anything: the parent owns
// the fetches, the pending id and the decision call, so this file is the two
// lists and their copy.

import Image from "next/image";

import { venuePhotoServePath } from "@/lib/venuePhotos";

export type ModeratorVenuePhoto = {
  id: string;
  venueId: string;
  authorProfileId: string;
  caption: string;
  drinkCategory: string | null;
  createdAt: string;
  reportReason?: string;
  reportCount?: number;
  reportedAt?: string;
  moderatedAt?: string;
  moderatorNote?: string;
};

export type VenuePhotoModerationProps = {
  reported: ModeratorVenuePhoto[];
  hidden: ModeratorVenuePhoto[];
  venueNames: Map<string, string>;
  pendingId: string | null;
  onDecide: (
    photo: ModeratorVenuePhoto,
    action: "restore" | "hide",
    lane: "reported" | "hidden",
  ) => void;
};

function venueLabel(photo: ModeratorVenuePhoto, names: Map<string, string>): string {
  return names.get(photo.venueId) ?? photo.venueId;
}

export default function VenuePhotoModeration({
  reported,
  hidden,
  venueNames,
  pendingId,
  onDecide,
}: VenuePhotoModerationProps) {
  return (
    <>
      <h2 className="admin-section">Reported wall photos</h2>
      <p className="admin-sub">
        Check reported photos from pub walls. Keep the good ones up, hide the
        rest. A report never takes a photo off a wall on its own.
      </p>
      {reported.length === 0 ? (
        <div className="admin-empty">
          <strong>No reported wall photos</strong>
          <span>Photos appear here after a reader reports one.</span>
        </div>
      ) : (
        <div className="admin-list">
          {reported.map((photo) => (
            <article className="admin-card" key={photo.id}>
              <div className="admin-card-head">
                <span className="admin-venue-name">{venueLabel(photo, venueNames)}</span>
                {photo.reportedAt ? (
                  <span className="admin-report">
                    Reported: {new Date(photo.reportedAt).toLocaleString()}
                  </span>
                ) : null}
              </div>
              <div className="admin-photos">
                <Image
                  className="admin-photo"
                  src={venuePhotoServePath(photo.venueId, photo.id)}
                  alt={`Reported photo at ${venueLabel(photo, venueNames)}`}
                  width={96}
                  height={120}
                  unoptimized
                />
              </div>
              <div className="admin-meta">
                {photo.caption ? <span>{photo.caption}</span> : null}
                {photo.drinkCategory ? (
                  <span className="admin-report">Drink: {photo.drinkCategory}</span>
                ) : null}
                {photo.reportReason ? (
                  <span className="admin-report">Reason: {photo.reportReason}</span>
                ) : null}
                <span className="admin-report">Reports: {photo.reportCount || 1}</span>
              </div>
              <div className="admin-actions">
                <button
                  className="admin-btn admin-restore"
                  onClick={() => onDecide(photo, "restore", "reported")}
                  disabled={pendingId === photo.id}
                >
                  {pendingId === photo.id ? "Working…" : "Keep visible"}
                </button>
                <button
                  className="admin-btn admin-keep"
                  onClick={() => onDecide(photo, "hide", "reported")}
                  disabled={pendingId === photo.id}
                >
                  {pendingId === photo.id ? "Working…" : "Hide"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <h2 className="admin-section">Hidden wall photos</h2>
      <p className="admin-sub">
        Photos a moderator has hidden. Hiding never deletes one, so any of these
        can go back on its wall.
      </p>
      {hidden.length === 0 ? (
        <div className="admin-empty">
          <strong>No hidden wall photos</strong>
          <span>Photos you hide from the queue above appear here.</span>
        </div>
      ) : (
        <div className="admin-list">
          {hidden.map((photo) => (
            <article className="admin-card" key={photo.id}>
              <div className="admin-card-head">
                <span className="admin-venue-name">{venueLabel(photo, venueNames)}</span>
                {photo.moderatedAt ? (
                  <span className="admin-report">
                    Hidden: {new Date(photo.moderatedAt).toLocaleString()}
                  </span>
                ) : null}
              </div>
              <div className="admin-meta">
                {photo.caption ? <span>{photo.caption}</span> : null}
                {photo.reportReason ? (
                  <span className="admin-report">Reason: {photo.reportReason}</span>
                ) : null}
                <span className="admin-report">Reports: {photo.reportCount || 0}</span>
                {photo.moderatorNote ? (
                  <span className="admin-report">Note: {photo.moderatorNote}</span>
                ) : null}
              </div>
              <div className="admin-actions">
                <button
                  className="admin-btn admin-restore"
                  onClick={() => onDecide(photo, "restore", "hidden")}
                  disabled={pendingId === photo.id}
                >
                  {pendingId === photo.id ? "Working…" : "Restore"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
