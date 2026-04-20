#include "ControlFramework.h"
#include <algorithm>
#include <cmath>

namespace control {

namespace {
double finiteOr(double value, double fallback) {
  return std::isfinite(value) ? value : fallback;
}

double trimf(double x, double a, double b, double c) {
  if (x <= a || x >= c) {
    return 0.0;
  }
  if (fabs(c - a) < 1e-9 || fabs(b - a) < 1e-9 || fabs(c - b) < 1e-9) {
    return 0.0;
  }
  if (x == b) {
    return 1.0;
  }
  if (x < b) {
    return std::clamp((x - a) / (b - a), 0.0, 1.0);
  }
  return std::clamp((c - x) / (c - b), 0.0, 1.0);
}

double leftShoulder(double x, double a, double b) {
  if (x <= a) {
    return 1.0;
  }
  if (x >= b) {
    return 0.0;
  }
  return (b - x) / (b - a);
}

double rightShoulder(double x, double a, double b) {
  if (x <= a) {
    return 0.0;
  }
  if (x >= b) {
    return 1.0;
  }
  return (x - a) / (b - a);
}

void addRule(double weight, double heaterDelta, double fanDelta, double &heaterWeighted, double &fanWeighted,
             double &weightSum) {
  if (weight <= 0.0) {
    return;
  }
  heaterWeighted += weight * heaterDelta;
  fanWeighted += weight * fanDelta;
  weightSum += weight;
}

double predictOutput(double a, double bHeater, double bFan, double c, double y, double heater, double fan) {
  return a * y + bHeater * heater + bFan * fan + c;
}

double ema(double previous, double value, double alpha) {
  if (!std::isfinite(previous)) {
    return value;
  }
  return previous + std::clamp(alpha, 0.0, 1.0) * (value - previous);
}

} // namespace

template <>
AdrcParams ScheduledTable<AdrcParams, 3, 3>::interpolate(const AdrcParams &a, const AdrcParams &b, double t) {
  AdrcParams out;
  out.b0 = a.b0 + (b.b0 - a.b0) * t;
  out.w0 = a.w0 + (b.w0 - a.w0) * t;
  out.wc = a.wc + (b.wc - a.wc) * t;
  out.fanBias = a.fanBias + (b.fanBias - a.fanBias) * t;
  out.fanGain = a.fanGain + (b.fanGain - a.fanGain) * t;
  return out;
}

template <>
PidParams ScheduledTable<PidParams, 3, 3>::interpolate(const PidParams &a, const PidParams &b, double t) {
  PidParams out;
  out.kp = a.kp + (b.kp - a.kp) * t;
  out.ki = a.ki + (b.ki - a.ki) * t;
  out.kd = a.kd + (b.kd - a.kd) * t;
  out.derivativeAlpha = a.derivativeAlpha + (b.derivativeAlpha - a.derivativeAlpha) * t;
  out.outputAlpha = a.outputAlpha + (b.outputAlpha - a.outputAlpha) * t;
  out.integralMin = a.integralMin + (b.integralMin - a.integralMin) * t;
  out.integralMax = a.integralMax + (b.integralMax - a.integralMax) * t;
  out.modelGain = a.modelGain + (b.modelGain - a.modelGain) * t;
  out.modelTauSeconds = a.modelTauSeconds + (b.modelTauSeconds - a.modelTauSeconds) * t;
  out.measuredLagSeconds = a.measuredLagSeconds + (b.measuredLagSeconds - a.measuredLagSeconds) * t;
  out.smithPredictorEnabled = a.smithPredictorEnabled || b.smithPredictorEnabled;
  return out;
}

template <>
MpcModel ScheduledTable<MpcModel, 3, 3>::interpolate(const MpcModel &a, const MpcModel &b, double t) {
  MpcModel out;
  out.aTb = a.aTb + (b.aTb - a.aTb) * t;
  out.aTe = a.aTe + (b.aTe - a.aTe) * t;
  out.bTbHeater = a.bTbHeater + (b.bTbHeater - a.bTbHeater) * t;
  out.bTbFan = a.bTbFan + (b.bTbFan - a.bTbFan) * t;
  out.bTeHeater = a.bTeHeater + (b.bTeHeater - a.bTeHeater) * t;
  out.bTeFan = a.bTeFan + (b.bTeFan - a.bTeFan) * t;
  out.cTb = a.cTb + (b.cTb - a.cTb) * t;
  out.cTe = a.cTe + (b.cTe - a.cTe) * t;
  out.tbWeight = a.tbWeight + (b.tbWeight - a.tbWeight) * t;
  out.teWeight = a.teWeight + (b.teWeight - a.teWeight) * t;
  out.moveHeaterWeight = a.moveHeaterWeight + (b.moveHeaterWeight - a.moveHeaterWeight) * t;
  out.moveFanWeight = a.moveFanWeight + (b.moveFanWeight - a.moveFanWeight) * t;
  out.rorWeight = a.rorWeight + (b.rorWeight - a.rorWeight) * t;
  out.horizon = a.horizon;
  return out;
}

const char *modeToString(Mode mode) {
  switch (mode) {
  case Mode::ADRC:
    return "adrc";
  case Mode::FUZZY:
    return "fuzzy";
  case Mode::MPC:
    return "mpc";
  default:
    return "pid";
  }
}

bool parseMode(const char *value, Mode &modeOut) {
  if (value == nullptr) {
    return false;
  }
  if (strncmp(value, "adrc", 4) == 0) {
    modeOut = Mode::ADRC;
    return true;
  }
  if (strncmp(value, "fuzzy", 5) == 0) {
    modeOut = Mode::FUZZY;
    return true;
  }
  if (strncmp(value, "mpc", 3) == 0) {
    modeOut = Mode::MPC;
    return true;
  }
  if (strncmp(value, "pid", 3) == 0) {
    modeOut = Mode::PID;
    return true;
  }
  return false;
}

uint32_t alarmBit(Alarm alarm) { return static_cast<uint32_t>(alarm); }

String alarmsToString(uint32_t alarms) {
  if (alarms == 0) {
    return "none";
  }
  String out;
  auto append = [&](Alarm alarm, const char *name) {
    if ((alarms & alarmBit(alarm)) == 0) {
      return;
    }
    if (out.length() > 0) {
      out += ",";
    }
    out += name;
  };
  append(Alarm::PROBE_FAULT, "probe_fault");
  append(Alarm::STALE_SAMPLE, "stale_sample");
  append(Alarm::IMPLAUSIBLE_READING, "implausible_reading");
  append(Alarm::FAN_STALL_OR_LOW_FLOW, "fan_low_flow");
  append(Alarm::RUNAWAY_TEMPERATURE, "runaway_temperature");
  append(Alarm::HEATER_SATURATED, "heater_saturated");
  append(Alarm::FAN_SATURATED, "fan_saturated");
  return out;
}

double clampWithSaturation(double value, double minValue, double maxValue, bool &saturated) {
  const double clamped = std::clamp(value, minValue, maxValue);
  saturated = saturated || fabs(clamped - value) > 1e-9;
  return clamped;
}

double applySlewLimit(double previous, double requested, double maxRatePerSec, double dtSeconds) {
  if (!std::isfinite(previous) || maxRatePerSec <= 0.0 || dtSeconds <= 0.0) {
    return requested;
  }
  const double maxDelta = maxRatePerSec * dtSeconds;
  return std::clamp(requested, previous - maxDelta, previous + maxDelta);
}

void SignalPreprocessor::configure(const SignalFilterConfig &nextConfig) { config = nextConfig; }

void SignalPreprocessor::reset() {
  current = ProcessSignals();
  initialized = false;
  previousTb = NAN;
  previousMs = 0;
}

double SignalPreprocessor::filter(double previous, double value, double alpha) {
  if (!std::isfinite(value)) {
    return previous;
  }
  if (!std::isfinite(previous)) {
    return value;
  }
  return previous + std::clamp(alpha, 0.0, 1.0) * (value - previous);
}

ProcessSignals SignalPreprocessor::update(const RawSignals &raw) {
  ProcessSignals next = current;
  next.ms = raw.ms;
  next.rawTb = raw.tb;
  next.rawTe = raw.te;
  next.rawDT = (std::isfinite(raw.te) && std::isfinite(raw.tb)) ? raw.te - raw.tb : NAN;
  next.ambient = raw.ambient;
  next.simTb = raw.simTb;
  next.valid = raw.probesHealthy && std::isfinite(raw.tb) && std::isfinite(raw.te);

  next.tb = filter(initialized ? current.tb : NAN, raw.tb, config.tbAlpha);
  next.te = filter(initialized ? current.te : NAN, raw.te, config.teAlpha);
  next.dT = filter(initialized ? current.dT : NAN, next.rawDT, config.dTAlpha);

  double measuredRor = NAN;
  if (initialized && previousMs != 0 && std::isfinite(next.tb) && std::isfinite(previousTb) && raw.ms > previousMs) {
    const double dtMinutes = (raw.ms - previousMs) / 60000.0;
    if (dtMinutes > 1e-6) {
      measuredRor = (next.tb - previousTb) / dtMinutes;
    }
  }
  next.ror = filter(initialized ? current.ror : NAN, measuredRor, config.rorAlpha);

  if (std::isfinite(next.tb)) {
    previousTb = next.tb;
  }
  previousMs = raw.ms;
  current = next;
  initialized = true;
  return current;
}

void SafetyMonitor::configure(const SafetyConfig &nextConfig) { config = nextConfig; }

SafetyDecision SafetyMonitor::evaluate(const RawSignals &raw, const ProcessSignals &signals, double heaterCommand,
                                       double fanCommand, const FanEnvelope &fanEnvelope) const {
  SafetyDecision decision;
  if (!raw.probesHealthy || !signals.valid) {
    decision.alarms |= alarmBit(Alarm::PROBE_FAULT);
    decision.forceHeaterOff = true;
  }
  if (raw.sampleAgeMs > config.maxSampleAgeMs) {
    decision.alarms |= alarmBit(Alarm::STALE_SAMPLE);
    decision.forceHeaterOff = true;
  }
  const bool tempImplausible = !std::isfinite(signals.tb) || !std::isfinite(signals.te) ||
                               signals.tb < config.minValidTemp || signals.te < config.minValidTemp ||
                               signals.tb > config.maxValidTemp || signals.te > config.maxValidTemp;
  if (tempImplausible) {
    decision.alarms |= alarmBit(Alarm::IMPLAUSIBLE_READING);
    decision.forceHeaterOff = true;
  }
  if (std::isfinite(signals.tb) && std::isfinite(signals.te) &&
      (signals.tb >= config.runawayTb || signals.te >= config.runawayTe)) {
    decision.alarms |= alarmBit(Alarm::RUNAWAY_TEMPERATURE);
    decision.forceHeaterOff = true;
    decision.forceFanMinimum = true;
  }
  const double requiredFan = std::max(config.minFanWhenHeating, fanEnvelope.min);
  if (config.requireFanForHeat && heaterCommand > config.heatingThreshold && fanCommand < requiredFan - 0.1) {
    decision.alarms |= alarmBit(Alarm::FAN_STALL_OR_LOW_FLOW);
    decision.forceHeaterOff = true;
    decision.forceFanMinimum = true;
  }
  return decision;
}

void PidController::reset(double currentOutput) {
  integral = 0.0;
  previousError = 0.0;
  filteredDerivative = 0.0;
  smoothedOutput = std::clamp(currentOutput, 0.0, 100.0);
  hasPreviousError = false;
}

ControlOutput PidController::update(const ControlRequest &request, const PidParams &params) {
  ControlOutput out;
  out.modeName = "pid";

  const double dtSeconds = std::max(0.001, request.dtSeconds);
  double controlTb = request.signals.tb;
  if (params.smithPredictorEnabled && params.measuredLagSeconds > 0.0 && std::isfinite(request.signals.ror)) {
    controlTb += (request.signals.ror / 60.0) * params.measuredLagSeconds;
  }
  out.predictionTb = controlTb;

  const double target = std::isfinite(request.setpoints.tb) ? request.setpoints.tb : controlTb;
  const double error = target - controlTb;
  double derivative = 0.0;
  if (hasPreviousError) {
    derivative = (error - previousError) / dtSeconds;
  } else {
    hasPreviousError = true;
  }
  filteredDerivative = ema(filteredDerivative, derivative, params.derivativeAlpha);

  double unsaturated = params.kp * error + params.ki * integral + params.kd * filteredDerivative;
  bool saturated = false;
  double clamped = clampWithSaturation(unsaturated, request.limits.heaterMin, request.limits.heaterMax, saturated);
  const bool allowIntegrate = !saturated || (unsaturated > request.limits.heaterMax && error < 0.0) ||
                              (unsaturated < request.limits.heaterMin && error > 0.0);
  if (allowIntegrate) {
    integral += error * dtSeconds;
    integral = std::clamp(integral, params.integralMin, params.integralMax);
    unsaturated = params.kp * error + params.ki * integral + params.kd * filteredDerivative;
    saturated = false;
    clamped = clampWithSaturation(unsaturated, request.limits.heaterMin, request.limits.heaterMax, saturated);
  }

  smoothedOutput += std::clamp(params.outputAlpha, 0.0, 1.0) * (clamped - smoothedOutput);
  saturated = false;
  out.heater = clampWithSaturation(smoothedOutput, request.limits.heaterMin, request.limits.heaterMax, saturated);
  out.rawHeater = unsaturated;
  out.rawFan = NAN;
  out.fan = NAN;
  out.internal1 = error;
  out.internal2 = integral;
  out.internal3 = filteredDerivative;
  out.heaterSaturated = saturated || fabs(out.rawHeater - out.heater) > 1e-6;
  if (out.heaterSaturated) {
    out.alarms |= alarmBit(Alarm::HEATER_SATURATED);
  }
  previousError = error;
  return out;
}

void AdrcController::reset(double measuredTemperature, double currentHeater) {
  z1 = measuredTemperature;
  z2 = 0.0;
  z3 = 0.0;
  lastCommand = std::clamp(currentHeater, 0.0, 100.0);
}

ControlOutput AdrcController::update(const ControlRequest &request, const AdrcParams &params, bool coordinatedFan) {
  ControlOutput out;
  out.modeName = "adrc";
  if (!std::isfinite(z1)) {
    reset(request.signals.tb, request.heaterFeedback);
  }

  const double dtSeconds = std::max(0.001, request.dtSeconds);
  const double y = request.signals.tb;
  const double b0 = std::max(0.001, params.b0);
  const double w0 = std::max(0.1, params.w0);
  const double wc = std::max(0.05, params.wc);
  const double beta1 = 3.0 * w0;
  const double beta2 = 3.0 * w0 * w0;
  const double beta3 = w0 * w0 * w0;
  const double observerError = z1 - y;

  z1 += dtSeconds * (z2 - beta1 * observerError + b0 * lastCommand);
  z2 += dtSeconds * (z3 - beta2 * observerError);
  z3 += dtSeconds * (-beta3 * observerError);

  const double target = std::isfinite(request.setpoints.tb) ? request.setpoints.tb : y;
  const double controlError = target - z1;
  const double rorError = std::isfinite(request.setpoints.ror) && std::isfinite(request.signals.ror)
                              ? (request.setpoints.ror - request.signals.ror) / 60.0
                              : 0.0;
  const double virtualControl = wc * controlError + 0.35 * rorError;
  out.rawHeater = (virtualControl - z2 - z3) / b0;

  bool heaterSaturated = false;
  const double heaterCommand =
      clampWithSaturation(out.rawHeater, request.limits.heaterMin, request.limits.heaterMax, heaterSaturated);
  lastCommand = applySlewLimit(lastCommand, heaterCommand, request.limits.heaterSlewPerSec, dtSeconds);
  out.heater = clampWithSaturation(lastCommand, request.limits.heaterMin, request.limits.heaterMax, heaterSaturated);
  out.heaterSaturated = heaterSaturated;

  if (coordinatedFan) {
    const double fanSpan = std::max(0.0, request.limits.fan.max - request.limits.fan.min);
    const double heatRelief = ((100.0 - out.heater) / 100.0) * fanSpan;
    const double dTTrim = std::isfinite(request.signals.dT) ? params.fanGain * request.signals.dT : 0.0;
    out.rawFan = params.fanBias + heatRelief + dTTrim;
    bool fanSaturated = false;
    out.fan = clampWithSaturation(out.rawFan, request.limits.fan.min, request.limits.fan.max, fanSaturated);
    out.fan = applySlewLimit(request.fanFeedback, out.fan, request.limits.fanSlewPerSec, dtSeconds);
    out.fan = clampWithSaturation(out.fan, request.limits.fan.min, request.limits.fan.max, fanSaturated);
    out.fanSaturated = fanSaturated;
  }

  out.internal1 = z1;
  out.internal2 = z2;
  out.internal3 = z3;
  out.predictionTb = z1;
  if (out.heaterSaturated) {
    out.alarms |= alarmBit(Alarm::HEATER_SATURATED);
  }
  if (out.fanSaturated) {
    out.alarms |= alarmBit(Alarm::FAN_SATURATED);
  }
  return out;
}

void FuzzyController::reset(double currentHeater, double currentFan) {
  heater = std::clamp(currentHeater, 0.0, 100.0);
  fan = std::clamp(currentFan, 0.0, 100.0);
}

ControlOutput FuzzyController::update(const ControlRequest &request, const FuzzyParams &params) {
  ControlOutput out;
  out.modeName = "fuzzy";
  const double targetTb = std::isfinite(request.setpoints.tb) ? request.setpoints.tb : request.signals.tb;
  const double targetRor = std::isfinite(request.setpoints.ror) ? request.setpoints.ror : request.signals.ror;
  const double eT = std::clamp((targetTb - request.signals.tb) / std::max(1.0, params.eTScale), -1.5, 1.5);
  const double eRor = std::isfinite(targetRor) && std::isfinite(request.signals.ror)
                          ? std::clamp((targetRor - request.signals.ror) / std::max(1.0, params.eRorScale), -1.5, 1.5)
                          : 0.0;
  const double dT = finiteOr(request.signals.dT, (params.dTLow + params.dTHigh) * 0.5);

  const double cold = leftShoulder(eT, -0.15, 0.0);
  const double near = trimf(eT, -0.30, 0.0, 0.30);
  const double hot = rightShoulder(eT, 0.0, 0.15);
  const double rorLow = rightShoulder(eRor, 0.0, 0.4);
  const double rorOk = trimf(eRor, -0.35, 0.0, 0.35);
  const double rorHigh = leftShoulder(eRor, -0.4, 0.0);
  const double dTLow = leftShoulder(dT, params.dTLow, params.dTLow + 15.0);
  const double dTHigh = rightShoulder(dT, params.dTHigh - 15.0, params.dTHigh);

  double heaterWeighted = 0.0;
  double fanWeighted = 0.0;
  double weightSum = 0.0;

  addRule(hot, 1.0, -0.20, heaterWeighted, fanWeighted, weightSum);
  addRule(cold, -1.0, 0.50, heaterWeighted, fanWeighted, weightSum);
  addRule(near * rorLow, 0.65, -0.15, heaterWeighted, fanWeighted, weightSum);
  addRule(near * rorHigh, -0.75, 0.80, heaterWeighted, fanWeighted, weightSum);
  addRule(rorOk * near, 0.0, 0.0, heaterWeighted, fanWeighted, weightSum);
  addRule(dTLow * hot, 0.50, -0.45, heaterWeighted, fanWeighted, weightSum);
  addRule(dTHigh * rorHigh, -0.45, 0.70, heaterWeighted, fanWeighted, weightSum);
  addRule(dTHigh * cold, -0.20, 0.45, heaterWeighted, fanWeighted, weightSum);

  const double heaterDelta = weightSum > 0.0 ? (heaterWeighted / weightSum) * params.heaterStepScale : 0.0;
  const double fanDelta = weightSum > 0.0 ? (fanWeighted / weightSum) * params.fanStepScale : 0.0;

  const double dtSeconds = std::max(0.001, request.dtSeconds);
  out.rawHeater = heater + heaterDelta;
  out.rawFan = fan + fanDelta;
  out.heater =
      applySlewLimit(heater, out.rawHeater, std::min(request.limits.heaterSlewPerSec, params.heaterSlewPerSec), dtSeconds);
  out.fan = applySlewLimit(fan, out.rawFan, std::min(request.limits.fanSlewPerSec, params.fanSlewPerSec), dtSeconds);

  bool heaterSaturated = false;
  bool fanSaturated = false;
  out.heater = clampWithSaturation(out.heater, request.limits.heaterMin, request.limits.heaterMax, heaterSaturated);
  out.fan = clampWithSaturation(out.fan, request.limits.fan.min, request.limits.fan.max, fanSaturated);
  heater = out.heater;
  fan = out.fan;
  out.heaterSaturated = heaterSaturated;
  out.fanSaturated = fanSaturated;
  out.internal1 = eT;
  out.internal2 = eRor;
  out.internal3 = dT;
  if (heaterSaturated) {
    out.alarms |= alarmBit(Alarm::HEATER_SATURATED);
  }
  if (fanSaturated) {
    out.alarms |= alarmBit(Alarm::FAN_SATURATED);
  }
  return out;
}

void MpcController::reset(double currentHeater, double currentFan) {
  heater = std::clamp(currentHeater, 0.0, 100.0);
  fan = std::clamp(currentFan, 0.0, 100.0);
}

ControlOutput MpcController::update(const ControlRequest &request, const MpcModel &model) {
  ControlOutput best;
  best.modeName = "mpc";
  double bestCost = INFINITY;

  const double heaterDeltas[] = {-8.0, -4.0, 0.0, 4.0, 8.0};
  const double fanDeltas[] = {-5.0, 0.0, 5.0};
  const double tbTarget = std::isfinite(request.setpoints.tb) ? request.setpoints.tb : request.signals.tb;
  const double teTarget = std::isfinite(request.setpoints.te) ? request.setpoints.te : request.signals.te;
  const double rorTarget = std::isfinite(request.setpoints.ror) ? request.setpoints.ror : request.signals.ror;

  for (double dHeater : heaterDeltas) {
    for (double dFan : fanDeltas) {
      bool heaterSaturated = false;
      bool fanSaturated = false;
      double candidateHeater = clampWithSaturation(heater + dHeater, request.limits.heaterMin, request.limits.heaterMax,
                                                   heaterSaturated);
      double candidateFan =
          clampWithSaturation(fan + dFan, request.limits.fan.min, request.limits.fan.max, fanSaturated);
      double tb = request.signals.tb;
      double te = request.signals.te;
      double cost = model.moveHeaterWeight * dHeater * dHeater + model.moveFanWeight * dFan * dFan;
      double previousTb = tb;
      const uint8_t horizon = std::clamp<uint8_t>(model.horizon, 1, 20);
      for (uint8_t i = 0; i < horizon; i++) {
        const double nextTb = predictOutput(model.aTb, model.bTbHeater, model.bTbFan, model.cTb, tb, candidateHeater,
                                            candidateFan);
        const double nextTe = predictOutput(model.aTe, model.bTeHeater, model.bTeFan, model.cTe, te, candidateHeater,
                                            candidateFan);
        const double predRor = (nextTb - previousTb) / std::max(1e-6, request.dtSeconds) * 60.0;
        const double tbErr = tbTarget - nextTb;
        const double teErr = std::isfinite(teTarget) ? teTarget - nextTe : 0.0;
        const double rorErr = std::isfinite(rorTarget) ? rorTarget - predRor : 0.0;
        cost += model.tbWeight * tbErr * tbErr + model.teWeight * teErr * teErr + model.rorWeight * rorErr * rorErr;
        previousTb = tb;
        tb = nextTb;
        te = nextTe;
      }

      if (cost < bestCost) {
        bestCost = cost;
        best.rawHeater = heater + dHeater;
        best.rawFan = fan + dFan;
        best.heaterSaturated = heaterSaturated;
        best.fanSaturated = fanSaturated;
        best.predictionTb = tb;
        best.predictionTe = te;
      }
    }
  }

  const double dtSeconds = std::max(0.001, request.dtSeconds);
  best.heater = applySlewLimit(heater, best.rawHeater, request.limits.heaterSlewPerSec, dtSeconds);
  best.fan = applySlewLimit(fan, best.rawFan, request.limits.fanSlewPerSec, dtSeconds);
  best.heater = clampWithSaturation(best.heater, request.limits.heaterMin, request.limits.heaterMax, best.heaterSaturated);
  best.fan = clampWithSaturation(best.fan, request.limits.fan.min, request.limits.fan.max, best.fanSaturated);
  heater = best.heater;
  fan = best.fan;
  best.internal1 = bestCost;
  if (best.heaterSaturated) {
    best.alarms |= alarmBit(Alarm::HEATER_SATURATED);
  }
  if (best.fanSaturated) {
    best.alarms |= alarmBit(Alarm::FAN_SATURATED);
  }
  return best;
}

void NoBeanIdentificationEstimator::reset() {
  hasBaseline = false;
  baselineTb = NAN;
  baselineTe = NAN;
  firstUh = NAN;
  firstUf = NAN;
  lastTb = NAN;
  lastTe = NAN;
  maxSlopeTb = 0.0;
  maxSlopeTe = 0.0;
  lagSeconds = NAN;
  previousTb = NAN;
  previousTe = NAN;
  previousElapsed = NAN;
}

void NoBeanIdentificationEstimator::observeStep(double elapsedSeconds, double tb, double te, double dT, double uh,
                                                double uf) {
  (void)dT;
  if (!std::isfinite(tb) || !std::isfinite(te)) {
    return;
  }
  if (!hasBaseline) {
    baselineTb = tb;
    baselineTe = te;
    firstUh = uh;
    firstUf = uf;
    hasBaseline = true;
  }
  if (std::isfinite(previousElapsed) && elapsedSeconds > previousElapsed) {
    const double dt = elapsedSeconds - previousElapsed;
    const double slopeTb = (tb - previousTb) / dt;
    const double slopeTe = (te - previousTe) / dt;
    maxSlopeTb = std::max(maxSlopeTb, fabs(slopeTb));
    maxSlopeTe = std::max(maxSlopeTe, fabs(slopeTe));
    if (!std::isfinite(lagSeconds) && fabs(tb - baselineTb) > 0.2) {
      lagSeconds = elapsedSeconds;
    }
  }
  previousElapsed = elapsedSeconds;
  previousTb = tb;
  previousTe = te;
  lastTb = tb;
  lastTe = te;
  firstUh = finiteOr(firstUh, uh);
  firstUf = finiteOr(firstUf, uf);
}

NoBeanCharacteristics NoBeanIdentificationEstimator::finish() const {
  NoBeanCharacteristics c;
  c.lagSeconds = lagSeconds;
  const double deltaTb = lastTb - baselineTb;
  const double deltaTe = lastTe - baselineTe;
  const double heatStep = std::max(1.0, fabs(firstUh));
  const double fanStep = std::max(1.0, fabs(firstUf));
  c.gainTbPerHeater = std::isfinite(deltaTb) ? deltaTb / heatStep : NAN;
  c.gainTePerHeater = std::isfinite(deltaTe) ? deltaTe / heatStep : NAN;
  c.gainTbPerFan = std::isfinite(deltaTb) ? -deltaTb / fanStep : NAN;
  c.gainTePerFan = std::isfinite(deltaTe) ? -deltaTe / fanStep : NAN;
  c.dTGain = std::isfinite(deltaTb) && std::isfinite(deltaTe) ? deltaTe - deltaTb : NAN;
  c.tauTbSeconds = maxSlopeTb > 1e-6 && std::isfinite(deltaTb) ? fabs(deltaTb) / maxSlopeTb : NAN;
  c.tauTeSeconds = maxSlopeTe > 1e-6 && std::isfinite(deltaTe) ? fabs(deltaTe) / maxSlopeTe : NAN;
  c.suggestedAdrcB0 = std::clamp(maxSlopeTb / 60.0, 0.001, 1.0);
  const double lag = std::isfinite(lagSeconds) && lagSeconds > 0.1 ? lagSeconds : 1.0;
  c.suggestedAdrcW0 = std::clamp(1.0 / lag, 0.2, 4.0);
  c.suggestedAdrcWc = std::clamp(c.suggestedAdrcW0 / 4.0, 0.05, 1.0);
  return c;
}

} // namespace control
