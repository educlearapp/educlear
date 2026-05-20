export default function TeacherNotificationsPage() {
  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Notifications</h1>
      <p className="teacher-muted">
        Parent-facing alerts (homework, notices, incidents, documents, and teacher replies) are recorded in the
        Communication Engine as in-app messages. Parents see them in the Parent Portal.
      </p>
      <p className="teacher-pwa-hint">
        <strong>Teacher device push:</strong> not wired yet. To reach parents today, the engine records in-app
        notifications; SMS, email, and WhatsApp sends depend on school communication profiles and queue workers.
      </p>
    </div>
  );
}
