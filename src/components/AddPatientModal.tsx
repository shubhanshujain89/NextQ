import React, { useState } from 'react';
import { 
  UserPlus, 
  IndianRupee, 
  ShieldAlert,
  X,
  Scale,
  Thermometer,
  Activity
} from 'lucide-react';
import { Clinic, TokenItem } from '../types/queue';
import { soundManager } from '../lib/audio';
import { PhoneInput } from './PhoneInput';

interface AddPatientModalProps {
  clinic: Clinic;
  onClose: () => void;
  onAdded: (token: TokenItem) => void;
}

export const AddPatientModal: React.FC<AddPatientModalProps> = ({
  clinic,
  onClose,
  onAdded,
}) => {
  const isBasicPlan = String(clinic.featurePlan || '').toUpperCase() === 'BASIC';
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [patientAge, setPatientAge] = useState('42');
  const [patientGender, setPatientGender] = useState<'Male' | 'Female' | 'Other'>('Male');
  const [isEmergency, setIsEmergency] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'CARD'>('CASH');
  const timingOptions = String(clinic.availableHours || '').split(',').map((slot) => slot.trim()).filter(Boolean);
  const [appointmentSlot, setAppointmentSlot] = useState(timingOptions.length === 1 ? timingOptions[0] : '');
  
  // Optional Vitals & Reception Notes (with predefined units)
  const [weight, setWeight] = useState('');
  const [temperature, setTemperature] = useState('');
  const [oxygenSaturation, setOxygenSaturation] = useState('');
  const [bpSystolic, setBpSystolic] = useState('');
  const [bpDiastolic, setBpDiastolic] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const consultationFee = clinic.consultationFee ?? 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientName.trim() || !patientPhone.trim()) return;

    setIsSubmitting(true);
    setSubmitError('');
    try {
      if (!clinic.doctorId) {
        throw new Error('No active doctor is configured for this clinic.');
      }
      if (timingOptions.length > 1 && !appointmentSlot) {
        throw new Error('Select an appointment timing.');
      }

      const formattedWeight = !isBasicPlan && weight.trim() ? `${weight.trim()} kg` : undefined;
      const formattedTemp = !isBasicPlan && temperature.trim() ? `${temperature.trim()} °F` : undefined;
      const formattedSpO2 = !isBasicPlan && oxygenSaturation.trim() ? `${oxygenSaturation.trim()}%` : undefined;
      const formattedBp = !isBasicPlan && (bpSystolic.trim() || bpDiastolic.trim())
        ? bpSystolic.trim() && bpDiastolic.trim()
          ? `${bpSystolic.trim()}/${bpDiastolic.trim()} mmHg`
          : `${bpSystolic.trim() || bpDiastolic.trim()} mmHg`
        : undefined;

      const response = await fetch(`/api/staff/queue/${encodeURIComponent(clinic.id)}/walk-in`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctorId: clinic.doctorId,
          patientName: patientName.trim(),
          phone: patientPhone.trim(),
          age: Number(patientAge) || undefined,
          tokenType: isEmergency ? 'EMERGENCY' : 'WALK_IN',
          appointmentSlot: appointmentSlot || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Unable to issue token (${response.status}).`);

      const newToken: TokenItem = {
        id: payload.tokenId,
        clinicId: payload.clinicId || clinic.id,
        doctorId: payload.doctorId || clinic.doctorId,
        sessionId: payload.sessionId || clinic.activeSessionId || 'sess_today',
        tokenNumber: payload.tokenNumber,
        sequenceNumber: payload.sequenceNumber,
        patientName: patientName.trim(),
        patientPhone: patientPhone.trim(),
        patientAge: Number(patientAge) || 35,
        patientGender,
        tokenType: isEmergency ? 'EMERGENCY' : 'WALK_IN',
        scheduledSlot: appointmentSlot || undefined,
        status: 'WAITING',
        isEmergency,
        isHold: false,
        priority: isEmergency ? 1 : 10,
        amountPaid: consultationFee,
        paymentMethod,
        paymentStatus: 'PAID',
        createdAt: new Date().toISOString(),
        weight: formattedWeight,
        temperature: formattedTemp,
        oxygenSaturation: formattedSpO2,
        bloodPressure: formattedBp,
      };

      if (isEmergency) {
        soundManager.playEmergencyChime();
      } else {
        soundManager.playChime();
      }

      onAdded(newToken);
      onClose();
    } catch (err) {
      console.error('Error adding walk-in patient:', err);
      setSubmitError(err instanceof Error ? err.message : 'Unable to issue the token. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-xl w-full max-h-[calc(100vh-2rem)] overflow-y-auto p-4 sm:p-6 shadow-2xl space-y-5 my-2">
        
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-xl bg-teal-500/10 text-teal-400">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Add Walk-In Patient</h3>
              <p className="text-xs text-slate-400">Issue live queue token & optional vitals intake</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {submitError && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {submitError}
            </div>
          )}
          
          {/* Patient Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1">
                Patient Name <span className="text-rose-400">*</span>
              </label>
              <input
                required
                type="text"
                placeholder="Patient name"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:ring-2 focus:ring-teal-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1">
                Phone Number <span className="text-rose-400">*</span>
              </label>
              <PhoneInput value={patientPhone} onChange={setPatientPhone} className="rounded-xl border-slate-800 bg-slate-950 text-xs text-slate-200" />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1">
                Age
              </label>
              <input
                type="number"
                placeholder="Age"
                value={patientAge}
                onChange={(e) => setPatientAge(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:ring-2 focus:ring-teal-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1">
                Gender
              </label>
              <select
                value={patientGender}
                onChange={(e) => setPatientGender(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:ring-2 focus:ring-teal-500 focus:outline-none"
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          {timingOptions.length > 1 && (
            <div>
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1">
                Appointment timing <span className="text-rose-400">*</span>
              </label>
              <select
                required
                value={appointmentSlot}
                onChange={(e) => setAppointmentSlot(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:ring-2 focus:ring-teal-500 focus:outline-none"
              >
                <option value="">Select timing</option>
                {timingOptions.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
              </select>
            </div>
          )}

          {/* Optional Vitals Section (Weight, Temperature, Blood Pressure) */}
          {!isBasicPlan && <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-teal-400 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-teal-400" />
                Patient Vitals (Optional)
              </span>
              <span className="text-[10px] text-slate-400 font-medium">Reception Pre-Check</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              {/* Weight with predefined kg */}
              <div>
                <label className="text-[11px] text-slate-400 font-medium block mb-1 flex items-center gap-1">
                  <Scale className="w-3 h-3 text-teal-400" />
                  Weight
                </label>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    step="0.1"
                    placeholder="68"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 pl-3 pr-10 text-xs text-white placeholder-slate-600 focus:ring-2 focus:ring-teal-500 focus:outline-none font-mono"
                  />
                  <span className="absolute right-3 text-xs font-bold text-teal-400 select-none pointer-events-none">
                    kg
                  </span>
                </div>
              </div>

              {/* Temperature with predefined °F */}
              <div>
                <label className="text-[11px] text-slate-400 font-medium block mb-1 flex items-center gap-1">
                  <Thermometer className="w-3 h-3 text-amber-400" />
                  Temperature
                </label>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    step="0.1"
                    placeholder="98.6"
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 pl-3 pr-10 text-xs text-white placeholder-slate-600 focus:ring-2 focus:ring-teal-500 focus:outline-none font-mono"
                  />
                  <span className="absolute right-3 text-xs font-bold text-amber-400 select-none pointer-events-none">
                    °F
                  </span>
                </div>
              </div>

              {/* Oxygen Saturation */}
              <div>
                <label className="text-[11px] text-slate-400 font-medium block mb-1 flex items-center gap-1">
                  <Activity className="w-3 h-3 text-cyan-400" />
                  SpO₂
                </label>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    step="0.1"
                    placeholder="98"
                    value={oxygenSaturation}
                    onChange={(e) => setOxygenSaturation(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 pl-3 pr-10 text-xs text-white placeholder-slate-600 focus:ring-2 focus:ring-teal-500 focus:outline-none font-mono"
                  />
                  <span className="absolute right-3 text-xs font-bold text-cyan-400 select-none pointer-events-none">
                    %
                  </span>
                </div>
              </div>

              {/* Blood Pressure with 2 columns and / in between */}
              <div>
                <label className="text-[11px] text-slate-400 font-medium block mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Activity className="w-3 h-3 text-rose-400" />
                    Blood Pressure
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">mmHg</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <div className="flex-1">
                    <input
                      type="number"
                      placeholder="120"
                      value={bpSystolic}
                      onChange={(e) => setBpSystolic(e.target.value)}
                      title="Systolic (SYS)"
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs text-white text-center placeholder-slate-600 focus:ring-2 focus:ring-teal-500 focus:outline-none font-mono"
                    />
                  </div>
                  <span className="text-slate-500 font-black text-sm select-none">/</span>
                  <div className="flex-1">
                    <input
                      type="number"
                      placeholder="80"
                      value={bpDiastolic}
                      onChange={(e) => setBpDiastolic(e.target.value)}
                      title="Diastolic (DIA)"
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs text-white text-center placeholder-slate-600 focus:ring-2 focus:ring-teal-500 focus:outline-none font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>}

          <div className="bg-rose-950/20 border border-rose-500/30 rounded-2xl p-3 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <div>
                <span className="text-xs font-bold text-white block">Emergency Priority</span>
                <span className="text-[10px] text-slate-400">Moves the patient to the front of the queue</span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={isEmergency}
              onChange={(e) => setIsEmergency(e.target.checked)}
              className="w-5 h-5 rounded bg-slate-950 border-rose-500 text-rose-500 focus:ring-0 cursor-pointer"
            />
          </div>

          {/* Payment Method */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setPaymentMethod('CASH')}
              className={`p-2 rounded-xl border text-xs font-bold text-center ${
                paymentMethod === 'CASH'
                  ? 'bg-teal-500/20 border-teal-500 text-teal-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              Cash Collected
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod('UPI')}
              className={`p-2 rounded-xl border text-xs font-bold text-center ${
                paymentMethod === 'UPI'
                  ? 'bg-teal-500/20 border-teal-500 text-teal-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              UPI / QR
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod('CARD')}
              className={`p-2 rounded-xl border text-xs font-bold text-center ${
                paymentMethod === 'CARD'
                  ? 'bg-teal-500/20 border-teal-500 text-teal-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              Card POS
            </button>
          </div>

          <div className="flex items-center justify-between text-xs font-bold text-slate-300 pt-2 border-t border-slate-800">
            <span>Fee Amount:</span>
            <span className="text-emerald-400 text-sm">₹{consultationFee}</span>
          </div>

          <div className="flex space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-3 bg-teal-500 hover:bg-teal-400 text-slate-950 rounded-xl text-xs font-black shadow-lg shadow-teal-500/20"
            >
              {isSubmitting ? 'Generating Slip...' : 'Issue Token Slip'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

