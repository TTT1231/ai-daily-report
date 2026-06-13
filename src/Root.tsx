import "./index.css";
import {Composition, Folder} from "remotion";
import {
  AiDailyReport,
  getReportDurationInFrames,
  TabLayoutPreview,
  type TabLayoutPreviewProps,
} from "./AiDailyReport";

export const RemotionRoot: React.FC = () => {
  const fps = 30;

  return (
    <>
    <Composition
      id="AiDailyReport"
      component={AiDailyReport}
      durationInFrames={getReportDurationInFrames(fps)}
      fps={fps}
      width={1920}
      height={1080}
    />
    <Folder name="Layout-Tests">
      <Composition
        id="TwoTabLayout"
        component={TabLayoutPreview}
        durationInFrames={90}
        fps={fps}
        width={1920}
        height={1080}
        defaultProps={
          {tabCount: 2, theme: "light"} satisfies TabLayoutPreviewProps
        }
      />
      <Composition
        id="FourTabLayout"
        component={TabLayoutPreview}
        durationInFrames={90}
        fps={fps}
        width={1920}
        height={1080}
        defaultProps={
          {tabCount: 4, theme: "light"} satisfies TabLayoutPreviewProps
        }
      />
      <Composition
        id="FiveTabLayout"
        component={TabLayoutPreview}
        durationInFrames={90}
        fps={fps}
        width={1920}
        height={1080}
        defaultProps={
          {tabCount: 5, theme: "light"} satisfies TabLayoutPreviewProps
        }
      />
    </Folder>
    </>
  );
};
