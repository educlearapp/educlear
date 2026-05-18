import "./AccessDenied.css";

type Props = {
  message?: string;
};

export default function AccessDenied({ message = "Access denied." }: Props) {
  return (
    <div className="access-denied" role="alert">
      <p className="access-denied__message">{message}</p>
    </div>
  );
}
