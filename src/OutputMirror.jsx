export default function OutputMirror({ src, title }) {
  return (
    <iframe
      title={title}
      src={src}
      style={{ display: "block", width: 1920, height: 1080, border: 0 }}
    />
  );
}
