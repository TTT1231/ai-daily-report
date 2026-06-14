import "./index.css";
import {Composition, Folder} from "remotion";
import {
  AiDailyReport,
  getReportDurationInFrames,
  TabLayoutPreview,
  type TabLayoutPreviewProps,
} from "./AiDailyReport";
import videoLayout from "../video-layout.json";

export const RemotionRoot: React.FC = () => {
  const fps = 30;

  return (
    <>
    <Composition
      id="AiDailyReport"
      component={AiDailyReport}
      durationInFrames={getReportDurationInFrames(fps)}
      fps={fps}
      width={videoLayout.width}
      height={videoLayout.height}
    />
    <Folder name="Layout-Tests">
      <Composition
        id="TwoTabLayout"
        component={TabLayoutPreview}
        durationInFrames={90}
        fps={fps}
        width={videoLayout.width}
        height={videoLayout.height}
        defaultProps={
          {tabCount: 2, theme: "light"} satisfies TabLayoutPreviewProps
        }
      />
      <Composition
        id="FourTabLayout"
        component={TabLayoutPreview}
        durationInFrames={90}
        fps={fps}
        width={videoLayout.width}
        height={videoLayout.height}
        defaultProps={
          {tabCount: 4, theme: "light"} satisfies TabLayoutPreviewProps
        }
      />
      <Composition
        id="FiveTabLayout"
        component={TabLayoutPreview}
        durationInFrames={90}
        fps={fps}
        width={videoLayout.width}
        height={videoLayout.height}
        defaultProps={
          {tabCount: 5, theme: "light"} satisfies TabLayoutPreviewProps
        }
      />
    </Folder>
    </>
  );
};
