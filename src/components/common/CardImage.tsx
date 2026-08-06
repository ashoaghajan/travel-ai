import { useEffect, useState } from 'react';

export type CardImageProps = {
  src?: string;
  /** Empty by default: card imagery is decorative next to its own title. */
  alt?: string;
  className?: string;
};

/**
 * Card photo that removes itself if the file cannot be loaded, letting the
 * container's gradient show through.
 *
 * Saved trips store the image URL they were created with. Those URLs are
 * content-hashed at build time, so a trip saved before a deploy can point at a
 * file that no longer exists — a missing photo should never leave a broken
 * image icon in the middle of a card.
 */
export function CardImage({ src, alt = '', className }: CardImageProps) {
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    setHasFailed(false);
  }, [src]);

  if (!src || hasFailed) return null;

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setHasFailed(true)}
    />
  );
}
