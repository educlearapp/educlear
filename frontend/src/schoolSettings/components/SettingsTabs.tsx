import type { SchoolSettingsTab } from "../types/schoolSettings";

type Props = {
  activeTab: SchoolSettingsTab;
  onTabChange: (tab: SchoolSettingsTab) => void;
};

const TABS: { id: SchoolSettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "documents", label: "Documents" },
];

export default function SettingsTabs({ activeTab, onTabChange }: Props) {
  return (
    <div className="school-settings-tabs" role="tablist" aria-label="School settings sections">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`school-settings-tab ${isActive ? "school-settings-tab--active" : ""}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
