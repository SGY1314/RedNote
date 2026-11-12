import { useEffect, useState } from "react";
import type { Asset } from "../api";
import { splitNoteText } from "../noteText";
import SourceMediaCarousel from "./SourceMediaCarousel";

export default function RewriteSourceNote({
  reference,
  assets,
  title = reference.title,
}: {
  reference: { title: string; body: string; topics: string[] };
  assets: Asset[];
  title?: string;
}) {
  const [index, setIndex] = useState(0);
  const signature = assets.map((asset) => asset.id).join();
  useEffect(() => setIndex(0), [signature]);
  const asset = assets[index];
  const note = splitNoteText(reference.body, reference.topics);
  return (
    <div className="title-original-note">
      <SourceMediaCarousel
        assets={assets}
        activeID={asset?.id}
        previousLabel="上一张原始素材"
        nextLabel="下一张原始素材"
        onPreview={(id) => setIndex(assets.findIndex((item) => item.id === id))}
      />
      <div className="title-original-content">
        <h3>{title}</h3>
        <div className="title-original-copy" aria-label="原始文案与标签">
          <p>{note.body}</p>
          {!!note.topics.length && (
            <div className="title-original-topics">
              {note.topics.map((topic) => (
                <span key={topic}>#{topic}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
