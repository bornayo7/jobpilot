import { useEffect, useState } from 'react';

/**
 * A text input bound to a string[] through comma separation.
 *
 * The naive version — `value={items.join(', ')}` with `onChange` that splits,
 * trims, and drops empties — cannot be typed into: the moment the user types
 * a comma the list parses to the same items, the input re-renders from the
 * joined list, and the comma disappears. Keeping the raw text as local state
 * lets the user type freely; the parsed list is pushed up on every change,
 * and the text re-syncs only when the outside value stops matching what the
 * text already represents (a profile switch, an import).
 */
export function CommaListInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  className?: string;
}) {
  const joined = value.join(', ');
  const [text, setText] = useState(joined);

  useEffect(() => {
    if (parseList(text).join(', ') !== joined) setText(joined);
  }, [joined, text]);

  return (
    <input
      className={className}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseList(e.target.value));
      }}
    />
  );
}

export function parseList(text: string): string[] {
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
