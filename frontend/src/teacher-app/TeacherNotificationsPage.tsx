export default function TeacherNotificationsPage() {
  return (
    <div>
      <h1 className="teacher-page-heading">Notifications</h1>
      <p className="teacher-muted">
        Parent-facing alerts (homework, notices, incidents, documents, and teacher replies) are recorded in the
        Communication Engine as in-app messages. Parents see them in the Parent Portal.
      </p>
      <p className="teacher-muted">
        While you are signed in to the Teacher Portal, new parent messages update your Inbox badge and show an
        in-app notice (polled while the app is open). Open Inbox to read and reply.
      </p>
      <p className="teacher-pwa-hint">
        <strong>Teacher device push:</strong> not wired yet — background/OS notifications when the Teacher Portal
        is closed are not supported. Parent Web Push (installed Parent Portal PWA) is separate and does not notify
        teachers.
      </p>
    </div>
  );
}
