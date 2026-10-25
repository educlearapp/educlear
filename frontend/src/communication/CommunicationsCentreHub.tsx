import { useState } from "react";
import TeacherInbox from "../teacher/TeacherInbox";
import AnnouncementsPanel from "./AnnouncementsPanel";
import "./communicationsCentreHub.css";

type Tab = "messages" | "announcements" | "events" | "notifications";

type Props = {
  schoolId: string;
  schoolName?: string;
};

export default function CommunicationsCentreHub({ schoolId, schoolName = "" }: Props) {
  const [tab, setTab] = useState<Tab>("messages");

  return (
    <div className="communications-centre-hub">
      <header className="communications-centre-hub__header">
        <div>
          <p className="communications-centre-hub__eyebrow">Staff · Parent communications</p>
          <h1 className="communications-centre-hub__title">Communications Centre</h1>
          <p className="communications-centre-hub__sub">
            Message parents and publish school notices from one place. Delivery queue, SMS and email tooling remain
            under Communication → Delivery queue / SMS / Email.
          </p>
        </div>
        {schoolName ? <div className="communications-centre-hub__school">{schoolName}</div> : null}
      </header>

      <div className="communications-centre-hub__tabs" role="tablist" aria-label="Communications Centre sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "messages"}
          className={`communications-centre-hub__tab${tab === "messages" ? " is-active" : ""}`}
          onClick={() => setTab("messages")}
        >
          Messages
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "announcements"}
          className={`communications-centre-hub__tab${tab === "announcements" ? " is-active" : ""}`}
          onClick={() => setTab("announcements")}
        >
          Announcements
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "events"}
          className={`communications-centre-hub__tab is-future${tab === "events" ? " is-active" : ""}`}
          onClick={() => setTab("events")}
          title="Placeholder — no event controls yet"
        >
          Events · soon
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "notifications"}
          className={`communications-centre-hub__tab is-future${tab === "notifications" ? " is-active" : ""}`}
          onClick={() => setTab("notifications")}
          title="Placeholder — no notification console yet"
        >
          Notifications · soon
        </button>
      </div>

      <div className="communications-centre-hub__panel" role="tabpanel">
        {tab === "messages" ? (
          <>
            <p className="communications-centre-hub__panel-note">
              Reuses the existing Teacher Inbox and parent–teacher threads. School admins can use admin view; teachers
              only see assigned threads. No new messaging stack.
            </p>
            <TeacherInbox embedded />
          </>
        ) : null}

        {tab === "announcements" ? (
          <>
            <p className="communications-centre-hub__panel-note">
              Reuses SchoolNotice via teacher-app (class) and admin staff notice (school-wide). Phase 0 parent draft /
              visibility rules and multi-child alert dedupe still apply. Edit/delete APIs are not part of this phase.
            </p>
            <AnnouncementsPanel schoolId={schoolId} />
          </>
        ) : null}

        {tab === "events" ? (
          <div className="communications-centre-hub__future">
            <span className="communications-centre-hub__badge">Future</span>
            <h3>Events calendar</h3>
            <p>
              School events are not modelled yet. This tab is a placeholder only — there are no create, publish or
              parent calendar controls here.
            </p>
          </div>
        ) : null}

        {tab === "notifications" ? (
          <div className="communications-centre-hub__future">
            <span className="communications-centre-hub__badge">Future</span>
            <h3>Notification centre</h3>
            <p>
              In-app parent alerts already exist from notices, homework and messages. A unified staff notification
              console (with live push/email/SMS providers) arrives in a later phase — no operational controls here.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
