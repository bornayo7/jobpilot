export function PlaceholderTab({ title, body }: { title: string; body: string }) {
  return (
    <div className="placeholder">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}
