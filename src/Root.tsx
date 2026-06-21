import "./index.css";
import {Composition, Folder} from "remotion";
import {
  AiDailyReport,
  getReportDurationInFrames,
  TabLayoutPreview,
  type TabLayoutPreviewProps,
} from "./AiDailyReport";
import videoLayout from "../video-layout.json";
// fps 与时间线常量共用同一事实源，避免 Root.tsx 的帧率与渲染/评论时间线漂移。
import videoTimeline from "../video-timeline.json";

export const RemotionRoot: React.FC = () => {
  const fps = videoTimeline.fps;

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
