/** @babel */
/** @jsx React.createElement */
import React from "react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import cx from "classnames";

dayjs.extend(relativeTime);

const shortLabels = {
  s: "Now",
  ss: "<1m",
  m: "1m",
  mm: "%dm",
  h: "1h",
  hh: "%dh",
  d: "1d",
  dd: "%dd",
  M: "1M",
  MM: "%dM",
  y: "1y",
  yy: "%dy",
};

function shortRelativeTime(date, now) {
  const seconds = now.diff(date, "second");
  const minutes = now.diff(date, "minute");
  const hours = now.diff(date, "hour");
  const days = now.diff(date, "day");
  const months = now.diff(date, "month");
  const years = now.diff(date, "year");

  const abs = Math.abs;
  const match = (abs(seconds) <= 44 && ["s", seconds]) ||
    (abs(seconds) < 90 && ["m", 1]) ||
    (abs(minutes) < 45 && ["mm", minutes]) ||
    (abs(minutes) < 90 && ["h", 1]) ||
    (abs(hours) < 22 && ["hh", hours]) ||
    (abs(hours) < 36 && ["d", 1]) ||
    (abs(days) < 26 && ["dd", days]) ||
    (abs(days) < 46 && ["M", 1]) ||
    (abs(months) < 11 && ["MM", months]) ||
    (abs(months) < 18 && ["y", 1]) || ["yy", years];

  const label = shortLabels[match[0]];
  return label.replace("%d", Math.abs(match[1]));
}

export default class Timeago extends React.Component {
  static defaultProps = {
    type: "span",
    displayStyle: "long",
  };

  static getTimeDisplay(time, now, style) {
    const d = dayjs(time);
    if (style === "short") {
      return shortRelativeTime(d, now);
    } else {
      const diff = d.diff(now, "month", true);
      if (Math.abs(diff) <= 1) {
        return d.from(now);
      } else {
        const format = d.format("MMM D, YYYY");
        return `on ${format}`;
      }
    }
  }

  componentDidMount() {
    this.timer = setInterval(() => this.forceUpdate(), 60000);
  }

  componentWillUnmount() {
    clearInterval(this.timer);
  }

  render() {
    const { type, time, displayStyle, ...others } = this.props;
    const display = Timeago.getTimeDisplay(time, dayjs(), displayStyle);
    const Type = type;
    const className = cx("timeago", others.className);
    return (
      <Type {...others} className={className}>
        {display}
      </Type>
    );
  }
}
