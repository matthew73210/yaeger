#pragma once

#include <Arduino.h>
#include <cstdint>

namespace control {

constexpr double kMinCommand = 0.0;
constexpr double kMaxCommand = 100.0;

enum class Mode : uint8_t {
  PID = 0,
  ADRC = 1,
  FUZZY = 2,
  MPC = 3,
};

enum class Alarm : uint32_t {
  NONE = 0,
  PROBE_FAULT = 1UL << 0,
  STALE_SAMPLE = 1UL << 1,
  IMPLAUSIBLE_READING = 1UL << 2,
  FAN_STALL_OR_LOW_FLOW = 1UL << 3,
  RUNAWAY_TEMPERATURE = 1UL << 4,
  HEATER_SATURATED = 1UL << 5,
  FAN_SATURATED = 1UL << 6,
};

struct RawSignals {
  unsigned long ms = 0;
  double tb = NAN;
  double te = NAN;
  double ambient = NAN;
  double simTb = NAN;
  unsigned long sampleAgeMs = 0;
  bool probesHealthy = false;
};

struct SignalFilterConfig {
  double tbAlpha = 0.25;
  double teAlpha = 0.25;
  double dTAlpha = 0.25;
  double rorAlpha = 0.20;
};

struct ProcessSignals {
  unsigned long ms = 0;
  double rawTb = NAN;
  double rawTe = NAN;
  double rawDT = NAN;
  double tb = NAN;
  double te = NAN;
  double dT = NAN;
  double ror = NAN; // deg C / minute, filtered derivative of filtered BT.
  double ambient = NAN;
  double simTb = NAN;
  bool valid = false;
};

struct Setpoints {
  double tb = NAN;
  double te = NAN;
  double ror = NAN;
};

struct FanEnvelope {
  double min = 30.0;
  double max = 80.0;
};

struct ActuatorLimits {
  double heaterMin = 0.0;
  double heaterMax = 100.0;
  FanEnvelope fan;
  double heaterSlewPerSec = 25.0;
  double fanSlewPerSec = 12.0;
};

struct ControlRequest {
  ProcessSignals signals;
  Setpoints setpoints;
  double heaterFeedback = 0.0;
  double fanFeedback = 0.0;
  ActuatorLimits limits;
  double dtSeconds = 0.4;
};

struct ControlOutput {
  double rawHeater = 0.0;
  double rawFan = NAN;
  double heater = 0.0;
  double fan = NAN;
  double internal1 = NAN;
  double internal2 = NAN;
  double internal3 = NAN;
  double predictionTb = NAN;
  double predictionTe = NAN;
  uint32_t alarms = 0;
  bool heaterSaturated = false;
  bool fanSaturated = false;
  const char *modeName = "pid";
};

struct SafetyConfig {
  double minValidTemp = -10.0;
  double maxValidTemp = 360.0;
  double runawayTb = 260.0;
  double runawayTe = 330.0;
  unsigned long maxSampleAgeMs = 2500;
  double minFanWhenHeating = 30.0;
  double heatingThreshold = 1.0;
  bool requireFanForHeat = true;
};

struct SafetyDecision {
  uint32_t alarms = 0;
  bool forceHeaterOff = false;
  bool forceFanMinimum = false;
};

struct PidParams {
  double kp = 1.0;
  double ki = 0.1;
  double kd = 0.01;
  double derivativeAlpha = 0.30;
  double outputAlpha = 0.25;
  double integralMin = -100.0;
  double integralMax = 100.0;
  double modelGain = 0.02;
  double modelTauSeconds = 20.0;
  double measuredLagSeconds = 0.0;
  bool smithPredictorEnabled = true;
};

struct AdrcParams {
  double b0 = 0.02;
  double w0 = 1.0;
  double wc = 0.25;
  double fanBias = 50.0;
  double fanGain = 0.0;
};

struct FuzzyParams {
  double eTScale = 20.0;
  double eRorScale = 20.0;
  double dTLow = 10.0;
  double dTHigh = 70.0;
  double heaterStepScale = 8.0;
  double fanStepScale = 5.0;
  double heaterSlewPerSec = 12.0;
  double fanSlewPerSec = 5.0;
};

struct MpcModel {
  // First-order 2x2 ARX-style model around the current operating point:
  // y[k+1] = a*y[k] + b*u[k] + c.
  double aTb = 0.985;
  double aTe = 0.970;
  double bTbHeater = 0.025;
  double bTbFan = -0.010;
  double bTeHeater = 0.060;
  double bTeFan = -0.035;
  double cTb = 0.0;
  double cTe = 0.0;
  double tbWeight = 1.0;
  double teWeight = 0.10;
  double moveHeaterWeight = 0.35;
  double moveFanWeight = 1.20;
  double rorWeight = 0.10;
  uint8_t horizon = 8;
};

struct NoBeanCharacteristics {
  double lagSeconds = NAN;
  double tauTbSeconds = NAN;
  double tauTeSeconds = NAN;
  double gainTbPerHeater = NAN;
  double gainTePerHeater = NAN;
  double gainTbPerFan = NAN;
  double gainTePerFan = NAN;
  double dTGain = NAN;
  double suggestedAdrcB0 = NAN;
  double suggestedAdrcW0 = NAN;
  double suggestedAdrcWc = NAN;
};

class SignalPreprocessor {
public:
  void configure(const SignalFilterConfig &config);
  void reset();
  ProcessSignals update(const RawSignals &raw);
  const ProcessSignals &last() const { return current; }

private:
  static double filter(double previous, double value, double alpha);

  SignalFilterConfig config;
  ProcessSignals current;
  bool initialized = false;
  double previousTb = NAN;
  unsigned long previousMs = 0;
};

class SafetyMonitor {
public:
  void configure(const SafetyConfig &config);
  SafetyDecision evaluate(const RawSignals &raw, const ProcessSignals &signals, double heaterCommand,
                          double fanCommand, const FanEnvelope &fanEnvelope) const;

private:
  SafetyConfig config;
};

template <typename T, size_t FAN_POINTS, size_t HEATER_POINTS>
class ScheduledTable {
public:
  void setAxes(const double (&fanAxisIn)[FAN_POINTS], const double (&heaterAxisIn)[HEATER_POINTS]) {
    for (size_t i = 0; i < FAN_POINTS; i++) {
      fanAxis[i] = fanAxisIn[i];
    }
    for (size_t i = 0; i < HEATER_POINTS; i++) {
      heaterAxis[i] = heaterAxisIn[i];
    }
  }

  void set(size_t fanIndex, size_t heaterIndex, const T &value) {
    if (fanIndex >= FAN_POINTS || heaterIndex >= HEATER_POINTS) {
      return;
    }
    values[fanIndex][heaterIndex] = value;
  }

  T lookup(double fan, double heater) const {
    size_t fi0 = 0;
    size_t fi1 = 0;
    double ft = 0.0;
    locate(fanAxis, FAN_POINTS, fan, fi0, fi1, ft);

    size_t hi0 = 0;
    size_t hi1 = 0;
    double ht = 0.0;
    locate(heaterAxis, HEATER_POINTS, heater, hi0, hi1, ht);

    const T a = interpolate(values[fi0][hi0], values[fi1][hi0], ft);
    const T b = interpolate(values[fi0][hi1], values[fi1][hi1], ft);
    return interpolate(a, b, ht);
  }

private:
  static void locate(const double *axis, size_t count, double x, size_t &i0, size_t &i1, double &t) {
    if (count == 0 || x <= axis[0]) {
      i0 = 0;
      i1 = 0;
      t = 0.0;
      return;
    }
    for (size_t i = 1; i < count; i++) {
      if (x <= axis[i]) {
        i0 = i - 1;
        i1 = i;
        const double span = axis[i1] - axis[i0];
        t = span > 1e-9 ? (x - axis[i0]) / span : 0.0;
        return;
      }
    }
    i0 = count - 1;
    i1 = count - 1;
    t = 0.0;
  }

  static T interpolate(const T &a, const T &b, double t);

  double fanAxis[FAN_POINTS] = {0};
  double heaterAxis[HEATER_POINTS] = {0};
  T values[FAN_POINTS][HEATER_POINTS] = {};
};

class PidController {
public:
  void reset(double currentOutput);
  ControlOutput update(const ControlRequest &request, const PidParams &params);

private:
  double integral = 0.0;
  double previousError = 0.0;
  double filteredDerivative = 0.0;
  double smoothedOutput = 0.0;
  bool hasPreviousError = false;
};

class AdrcController {
public:
  void reset(double measuredTemperature, double currentHeater);
  ControlOutput update(const ControlRequest &request, const AdrcParams &params, bool coordinatedFan);

private:
  double z1 = NAN;
  double z2 = 0.0;
  double z3 = 0.0;
  double lastCommand = 0.0;
};

class FuzzyController {
public:
  void reset(double currentHeater, double currentFan);
  ControlOutput update(const ControlRequest &request, const FuzzyParams &params);

private:
  double heater = 0.0;
  double fan = 0.0;
};

class MpcController {
public:
  void reset(double currentHeater, double currentFan);
  ControlOutput update(const ControlRequest &request, const MpcModel &model);

private:
  double heater = 0.0;
  double fan = 0.0;
};

class NoBeanIdentificationEstimator {
public:
  void reset();
  void observeStep(double elapsedSeconds, double tb, double te, double dT, double uh, double uf);
  NoBeanCharacteristics finish() const;

private:
  bool hasBaseline = false;
  double baselineTb = NAN;
  double baselineTe = NAN;
  double firstUh = NAN;
  double firstUf = NAN;
  double lastTb = NAN;
  double lastTe = NAN;
  double maxSlopeTb = 0.0;
  double maxSlopeTe = 0.0;
  double lagSeconds = NAN;
  double previousTb = NAN;
  double previousTe = NAN;
  double previousElapsed = NAN;
};

const char *modeToString(Mode mode);
bool parseMode(const char *value, Mode &modeOut);
uint32_t alarmBit(Alarm alarm);
String alarmsToString(uint32_t alarms);
double clampWithSaturation(double value, double minValue, double maxValue, bool &saturated);
double applySlewLimit(double previous, double requested, double maxRatePerSec, double dtSeconds);

} // namespace control
