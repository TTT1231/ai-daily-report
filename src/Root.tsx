import "./index.css";
import { Composition } from "remotion";
import {AiDailyReport, getReportDurationInFrames} from "./AiDailyReport";

export const RemotionRoot: React.FC = () => {
  const fps = 30;

  return (
    <Composition
      id="AiDailyReport"
      component={AiDailyReport}
      durationInFrames={getReportDurationInFrames(fps)}
      fps={fps}
      width={1920}
      height={1080}
    />
  );
};
