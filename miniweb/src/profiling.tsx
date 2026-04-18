import { ChangeEvent } from "preact/compat";
import { useState } from "preact/hooks";
import { ProfileEditorGraph } from "./graphs";
import { Profile, RoastState } from "./model";

export type ProfileStore = {
  profile?: Profile;
  profileName: string;
  followProfileEnabled: boolean;
};

export const profileStore: ProfileStore = {
  profile: undefined,
  profileName: "",
  followProfileEnabled: false,
};

export function followProfile(
  profile: Profile,
  roast: RoastState,
): { setPoint: number; fanValue?: number; heaterValue?: number } | undefined {
  if (!roast.startDate) return undefined;

  const elapsedTime = (new Date().getTime() - roast.startDate.getTime()) / 1000;
  let accumulatedTime = 0;

  for (const step of profile.steps) {
    accumulatedTime += step.duration;
    if (elapsedTime <= accumulatedTime) {
      const stepStartTime = accumulatedTime - step.duration;
      const progress = (elapsedTime - stepStartTime) / step.duration;
      const prevSetpoint =
        stepStartTime === 0
          ? profile.steps[0].setpoint
          : profile.steps.find((s, i) => profile.steps[i + 1] === step)?.setpoint ||
            step.setpoint;

      return {
        setPoint:
          Math.floor(
            interpolateSetpoint(
              prevSetpoint,
              step.setpoint,
              progress,
              step.interpolation,
            ) * 10,
          ) / 10,
        fanValue: step.fanValue,
        heaterValue: step.heaterValue,
      };
    }
  }

  return profile.steps.length > 0
    ? {
        setPoint: profile.steps[profile.steps.length - 1].setpoint,
        fanValue: profile.steps[profile.steps.length - 1].fanValue,
        heaterValue: profile.steps[profile.steps.length - 1].heaterValue,
      }
    : undefined;
}

function interpolateSetpoint(
  start: number,
  end: number,
  progress: number,
  type: "linear" | "ease-in" | "ease-out" | "ease-in-out",
): number {
  switch (type) {
    case "linear":
      return start + (end - start) * progress;
    case "ease-in":
      return start + (end - start) * Math.pow(progress, 2);
    case "ease-out":
      return start + (end - start) * (1 - Math.pow(1 - progress, 2));
    case "ease-in-out":
      return (
        start +
        (end - start) *
          (progress < 0.5
            ? 2 * Math.pow(progress, 2)
            : 1 - Math.pow(-2 * progress + 2, 2) / 2)
      );
    default:
      return end;
  }
}

function isValidProfile(obj: unknown): obj is Profile {
  return !!obj && typeof obj === "object" && "steps" in obj;
}

type ProfileControlProps = {
  onStateChange: () => void;
  onProfileChange?: (profile?: Profile) => void;
  onFollowProfileToggle?: (enabled: boolean) => void;
};

const DEFAULT_PROFILE: Profile = {
  steps: [
    { interpolation: "linear", setpoint: 160, duration: 180, fanValue: 30, heaterValue: 58 },
    { interpolation: "linear", setpoint: 185, duration: 180, fanValue: 40, heaterValue: 65 },
    { interpolation: "linear", setpoint: 205, duration: 120, fanValue: 55, heaterValue: 72 },
    { interpolation: "linear", setpoint: 220, duration: 120, fanValue: 65, heaterValue: 78 },
  ],
};

const BUILT_IN_PROFILES: Array<{ id: string; name: string; profile: Profile }> = [
  { id: "quick-10", name: "Quick 10 min", profile: DEFAULT_PROFILE },
  {
    id: "balanced-12",
    name: "Balanced 12 min",
    profile: {
      steps: [
        { interpolation: "linear", setpoint: 155, duration: 180, fanValue: 30, heaterValue: 60 },
        { interpolation: "linear", setpoint: 180, duration: 210, fanValue: 40, heaterValue: 67 },
        { interpolation: "linear", setpoint: 198, duration: 180, fanValue: 50, heaterValue: 72 },
        { interpolation: "linear", setpoint: 212, duration: 150, fanValue: 60, heaterValue: 78 },
      ],
    },
  },
  {
    id: "development-forward",
    name: "Development forward 14 min",
    profile: {
      steps: [
        { interpolation: "linear", setpoint: 150, duration: 240, fanValue: 25, heaterValue: 58 },
        { interpolation: "linear", setpoint: 175, duration: 240, fanValue: 35, heaterValue: 64 },
        { interpolation: "linear", setpoint: 200, duration: 210, fanValue: 50, heaterValue: 72 },
        { interpolation: "linear", setpoint: 220, duration: 150, fanValue: 70, heaterValue: 80 },
      ],
    },
  },
];

export function ProfileControl({
  onStateChange,
  onProfileChange,
  onFollowProfileToggle,
}: ProfileControlProps) {
  const [error, setError] = useState("");
  const [selectedBuiltIn, setSelectedBuiltIn] = useState("");
  const notifyProfileChange = (profile?: Profile) => {
    profileStore.profile = profile;
    onProfileChange?.(profile);
    onStateChange();
  };

  const onProfileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse((e.target?.result as string) || "{}");
        if (!isValidProfile(parsed)) {
          throw new Error("Invalid profile format");
        }
        profileStore.profile = parsed;
        profileStore.profileName = file.name;
        setSelectedBuiltIn("");
        setError("");
        notifyProfileChange(parsed);
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div class="profile-control">
      <label>
        Built-in profile
        <select
          value={selectedBuiltIn}
          onChange={(e) => {
            const value = (e.target as HTMLSelectElement).value;
            setSelectedBuiltIn(value);
            if (!value) return;
            const selected = BUILT_IN_PROFILES.find((item) => item.id === value);
            if (!selected) return;
            profileStore.profileName = selected.name;
            notifyProfileChange({
              steps: selected.profile.steps.map((step) => ({ ...step })),
            });
          }}
        >
          <option value="">Choose built-in profile</option>
          {BUILT_IN_PROFILES.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </label>
      <div class="profile-chip">Profile: {profileStore.profile ? profileStore.profileName : "waiting"}</div>
      <input
        id="profileInput"
        type="file"
        accept="application/json"
        onChange={onProfileUpload}
      />
      <div class="inline-actions">
        <button
          onClick={() => {
            profileStore.profileName = "";
            setSelectedBuiltIn("");
            notifyProfileChange(undefined);
          }}
        >
          Clear
        </button>
        <button
          onClick={() => {
            profileStore.profileName = "10-minute-template";
            setSelectedBuiltIn("quick-10");
            notifyProfileChange({
              steps: DEFAULT_PROFILE.steps.map((step) => ({ ...step })),
            });
          }}
        >
          New 10 min template
        </button>
        <button
          disabled={!profileStore.profile}
          onClick={() => {
            if (!profileStore.profile) return;
            const blob = new Blob([JSON.stringify(profileStore.profile, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${profileStore.profileName || "profile"}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download profile
        </button>
      </div>
      <label class="switch-label">
        <input
          type="checkbox"
          checked={profileStore.followProfileEnabled}
          onChange={(e) => {
            profileStore.followProfileEnabled = e.currentTarget.checked;
            onFollowProfileToggle?.(e.currentTarget.checked);
            onStateChange();
          }}
        />
        Follow Profile Enabled
      </label>
      {profileStore.profile && (
        <>
          <ProfileEditorGraph
            profile={profileStore.profile}
            onChange={(next) => notifyProfileChange(next)}
          />
          <div class="profile-steps-list">
            {profileStore.profile.steps.map((step, index) => (
              <div class="profile-step-row" key={`step-${index}`}>
                <strong>Phase {index + 1}</strong>
                <label>
                  Temp
                  <input
                    type="number"
                    min="0"
                    max="300"
                    value={step.setpoint}
                    onInput={(e) => {
                      const value = Number((e.target as HTMLInputElement).value);
                      const next = { steps: profileStore.profile!.steps.map((item) => ({ ...item })) };
                      next.steps[index].setpoint = Number.isFinite(value) ? value : step.setpoint;
                      notifyProfileChange(next);
                    }}
                  />
                </label>
                <label>
                  Fan %
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="5"
                    value={step.fanValue ?? 0}
                    onInput={(e) => {
                      const value = Number((e.target as HTMLInputElement).value);
                      const next = { steps: profileStore.profile!.steps.map((item) => ({ ...item })) };
                      next.steps[index].fanValue = Number.isFinite(value) ? value : step.fanValue ?? 0;
                      notifyProfileChange(next);
                    }}
                  />
                </label>
                <label>
                  Heater %
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="5"
                    value={step.heaterValue ?? 0}
                    onInput={(e) => {
                      const value = Number((e.target as HTMLInputElement).value);
                      const next = { steps: profileStore.profile!.steps.map((item) => ({ ...item })) };
                      next.steps[index].heaterValue = Number.isFinite(value) ? value : step.heaterValue ?? 0;
                      notifyProfileChange(next);
                    }}
                  />
                </label>
                <label>
                  Duration (s)
                  <input
                    type="number"
                    min="15"
                    step="15"
                    value={step.duration}
                    onInput={(e) => {
                      const value = Number((e.target as HTMLInputElement).value);
                      const next = { steps: profileStore.profile!.steps.map((item) => ({ ...item })) };
                      next.steps[index].duration = Math.max(15, Number.isFinite(value) ? value : step.duration);
                      notifyProfileChange(next);
                    }}
                  />
                </label>
                <button
                  onClick={() => {
                    if (!profileStore.profile || profileStore.profile.steps.length <= 1) return;
                    const next = {
                      steps: profileStore.profile.steps
                        .filter((_, stepIndex) => stepIndex !== index)
                        .map((item) => ({ ...item })),
                    };
                    notifyProfileChange(next);
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              onClick={() => {
                if (!profileStore.profile) return;
                const last = profileStore.profile.steps[profileStore.profile.steps.length - 1];
                const next = {
                  steps: [
                    ...profileStore.profile.steps.map((item) => ({ ...item })),
                    { ...last, duration: 120 },
                  ],
                };
                notifyProfileChange(next);
              }}
            >
              Add phase
            </button>
          </div>
        </>
      )}
      {error && <p style="color:#b91c1c;">Profile error: {error}</p>}
    </div>
  );
}
