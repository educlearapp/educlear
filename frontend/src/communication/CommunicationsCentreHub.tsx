import { useMemo, useState } from "react";
import TeacherInbox from "../teacher/TeacherInbox";
import AnnouncementsPanel from "./AnnouncementsPanel";
import EventsPanel from "./EventsPanel";
import DocumentsPanel from "./DocumentsPanel";
import NotificationsOverviewPanel from "./NotificationsOverviewPanel";
import CommunicationCentre from "./CommunicationCentre";
import { hasCommunicationsPermission } from "../users/permissions";
import { getSchoolSessionUser } from "../auth/schoolSession";
import "./communicationsCentreHub.css";

type Tab =
  | "messages"
  | "announcements"
  | "events"
  | "notifications"
  | "documents"
  | "deliveryQueue";

type Props = {
  schoolId: string;
  schoolName?: string;
};

function canAccessDeliveryQueue(): boolean {
  const user = getSchoolSessionUser();
  // Delivery Queue is part of Communications Centre — communications.view (Owner always true).
  return hasCommunicationsPermission(user, "view");
}

const TABS: { id: Tab; label: string; adminOnly?: boolean }[] = [
  { id: "messages", label: "Messages" },
  { id: "announcements", label: "Announcements" },
  { id: "events", label: "Events" },
  { id: "notifications", label: "Notifications" },
  { id: "documents", label: "Documents" },
  { id: "deliveryQueue", label: "Delivery Queue", adminOnly: true },
];

export default function CommunicationsCentreHub({ schoolId, schoolName = "" }: Props) {
  const showQueue = useMemo(() => canAccessDeliveryQueue(), []);
  const [tab, setTab] = useState<Tab>("messages");

  const visibleTabs = TABS.filter((t) => !t.adminOnly || showQueue);

  return (
    <div className="communications-centre-hub">
      <header className="communications-centre-hub__header">
        <div>
          <p className="communications-centre-hub__eyebrow">Staff · Parent communications</p>
          <h1 className="communications-centre-hub__title">Communications Centre</h1>
          <p className="communications-centre-hub__sub">
            One workspace for parent messaging, announcements, events, notifications, documents and the
            outbound delivery queue. Reuses existing Teacher Inbox, SchoolNotice, SchoolEvent and ParentDocument
            systems — no parallel stacks.
          </p>
        </div>
        {schoolName ? <div className="communications-centre-hub__school">{schoolName}</div> : null}
      </header>

      <div className="communications-centre-hub__tabs" role="tablist" aria-label="Communications Centre sections">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`communications-centre-hub__tab${tab === t.id ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
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
              Manages SchoolNotice lifecycle (draft → publish → edit → unpublish → republish → archive) with audit trail.
              Parents only see published notices. In-app notify on first publish / republish; ordinary edits do not
              re-notify. No SMS or email from this panel.
            </p>
            <AnnouncementsPanel schoolId={schoolId} />
          </>
        ) : null}

        {tab === "events" ? (
          <>
            <p className="communications-centre-hub__panel-note">
              SchoolEvent lifecycle (draft → publish → edit → cancel → archive) with audit trail. Parents see published
              and cancelled events for their children; drafts and archived stay staff-only. In-app notify on first
              publish only.
            </p>
            <EventsPanel schoolId={schoolId} />
          </>
        ) : null}

        {tab === "notifications" ? <NotificationsOverviewPanel schoolId={schoolId} /> : null}

        {tab === "documents" ? (
          <>
            <p className="communications-centre-hub__panel-note">
              ParentDocument listing, upload and targeting. Teachers are limited to assigned classes; Admin/Owner may
              publish school-wide or by grade. Authenticated downloads enforce school tenancy.
            </p>
            <DocumentsPanel schoolId={schoolId} />
          </>
        ) : null}

        {tab === "deliveryQueue" && showQueue ? (
          <>
            <p className="communications-centre-hub__panel-note">
              School-scoped outbound queue. Preview never sends. Process requires explicit confirmation and never runs
              on tab open. Simulated providers are held — never marked sent.
            </p>
            <CommunicationCentre schoolId={schoolId} schoolName={schoolName} embedded />
          </>
        ) : null}
      </div>
    </div>
  );
}
