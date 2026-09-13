import React, { useState, useEffect } from 'react';
import { PhoneInput } from './PhoneInput';
import {
  Stethoscope,
  Activity,
  Users,
  IndianRupee,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  TrendingUp,
  UserCheck,
  ShieldCheck,
  Sparkles,
  Phone,
  Calendar,
  Eye,
  Volume2,
  Edit3,
  Scale,
  Thermometer,
  Save,
  X,
  Trash2
} from 'lucide-react';
import { Clinic, TokenItem, QueueSession } from '../types/queue';
import { db, doc, collection, setDoc } from '../lib/firebase';
import type { User } from '../lib/firebase';
import { soundManager } from '../lib/audio';
import { getDoctorQueueAction } from './doctorQueueLogic';
import { getAverageWaitSummary } from './waitMetrics';
import { formatDoctorName } from '../lib/doctorName';

interface DoctorViewProps {
  clinic: Clinic;
  session: QueueSession | null;
  tokens: TokenItem[];
  currentUser: User | null;
  onGoogleSignIn: () => void;
  onClinicUpdated?: (clinic: Clinic) => void;
}

export const DoctorView: React.FC<DoctorViewProps> = ({
  clinic,
  session,
  tokens,
  currentUser,
  onGoogleSignIn,
  onClinicUpdated,
}) => {
  const isBasicPlan = String(clinic.featurePlan || '').toUpperCase() === 'BASIC';
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isPatientListOpen, setIsPatientListOpen] = useState(false);
  const [isDeletingPatient, setIsDeletingPatient] = useState(false);
  const [selectedScheduledSlot, setSelectedScheduledSlot] = useState('ALL');

  // Doctor editing patient details state
  const [editingToken, setEditingToken] = useState<TokenItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAge, setEditAge] = useState('');
  const [editGender, setEditGender] = useState<'Male' | 'Female' | 'Other'>('Male');
  const [editSymptoms, setEditSymptoms] = useState('');
  const [editDuration, setEditDuration] = useState('');
  const [editSeverity, setEditSeverity] = useState<'Mild' | 'Moderate' | 'Severe' | 'Critical'>('Mild');
  const [editPainScale, setEditPainScale] = useState(3);
  const [editAllergies, setEditAllergies] = useState('');
  const [editTemp, setEditTemp] = useState('');
  const [editSpO2, setEditSpO2] = useState('');
  const [editBpSys, setEditBpSys] = useState('');
  const [editBpDia, setEditBpDia] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [roomNumber, setRoomNumber] = useState(clinic.cabinNumber || '');
  const [editingRoomNumber, setEditingRoomNumber] = useState(false);
  const [isSavingRoomNumber, setIsSavingRoomNumber] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleDeleteConsultation = async (token: TokenItem) => {
    if (!['WAITING', 'HOLD'].includes(token.status)) return;
    if (!window.confirm(`Delete the consultation for ${token.patientName}?`)) return;

    setIsDeletingPatient(true);
    try {
      const response = await fetch(`/api/staff/queue/${encodeURIComponent(token.id)}/cancel`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to delete consultation.');
      showToast(`Deleted consultation for ${token.patientName}.`);
    } catch (error) {
      console.error('Error deleting consultation:', error);
      showToast('Unable to delete consultation. Please retry.');
    } finally {
      setIsDeletingPatient(false);
    }
  };

  const openEditModal = (token: TokenItem) => {
    setEditingToken(token);
    setEditName(token.patientName || '');
    setEditPhone(token.patientPhone || '');
    setEditAge(token.patientAge ? String(token.patientAge) : '35');
    setEditGender(token.patientGender || 'Male');
    
    const preNotes = token.preConsultationNotes;
    setEditSymptoms(preNotes?.symptoms || 'General Consultation');
    setEditDuration(preNotes?.duration || '2 days');
    setEditSeverity(preNotes?.severity || 'Mild');
    setEditPainScale(preNotes?.painScale || 3);
    setEditAllergies(preNotes?.allergies || '');

    const rawWeight = token.weight || preNotes?.weight || '';
    setEditWeight(rawWeight.replace(/[^\d.]/g, ''));

    const rawTemp = token.temperature || preNotes?.temperature || preNotes?.feverTemp || '';
    setEditTemp(rawTemp.replace(/[^\d.]/g, ''));

    const rawSpO2 = token.oxygenSaturation || preNotes?.oxygenSaturation || preNotes?.spo2 || '';
    setEditSpO2(String(rawSpO2 || '').replace(/[^\d.]/g, ''));

    const rawBp = token.bloodPressure || preNotes?.bloodPressure || preNotes?.bpReading || '';
    if (rawBp.includes('/')) {
      const parts = rawBp.split('/');
      setEditBpSys(parts[0].replace(/\D/g, ''));
      setEditBpDia(parts[1].replace(/\D/g, ''));
    } else {
      setEditBpSys(rawBp.replace(/\D/g, ''));
      setEditBpDia('');
    }

    setEditNotes(token.triageNotes || preNotes?.triageNotes || preNotes?.receptionNotes || '');
  };

  const handleSaveRoomNumber = async () => {
    if (!clinic.id || isBasicPlan) return;
    setIsSavingRoomNumber(true);
    try {
      const response = await fetch(`/api/staff/clinic/${encodeURIComponent(clinic.id)}/cabin`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cabinNumber: roomNumber.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to update room number.');
      const nextClinic = { ...clinic, cabinNumber: roomNumber.trim() };
      if (onClinicUpdated) onClinicUpdated(nextClinic);
      setRoomNumber(roomNumber.trim());
      setEditingRoomNumber(false);
      showToast('Room number updated.');
    } catch (error) {
      console.error('Error updating room number:', error);
      showToast(error instanceof Error ? error.message : 'Unable to update room number.');
    } finally {
      setIsSavingRoomNumber(false);
    }
  };

  const handleSavePatientEdits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingToken) return;

    setIsSavingEdit(true);
    try {
      const formattedWeight = editWeight.trim() ? `${editWeight.trim()} kg` : undefined;
      const formattedTemp = editTemp.trim() ? `${editTemp.trim()} °F` : undefined;
      const formattedSpO2 = editSpO2.trim() ? `${editSpO2.trim()}%` : undefined;
      const formattedBp =
        editBpSys.trim() && editBpDia.trim()
          ? `${editBpSys.trim()}/${editBpDia.trim()} mmHg`
          : editBpSys.trim()
          ? `${editBpSys.trim()} mmHg`
          : undefined;

      const updatedPreNotes = {
        ...(editingToken.preConsultationNotes || {}),
        symptoms: editSymptoms.trim(),
        duration: editDuration.trim() || undefined,
        severity: editSeverity,
        painScale: Number(editPainScale) || 0,
        allergies: editAllergies.trim() || undefined,
        temperature: formattedTemp,
        feverTemp: formattedTemp,
        oxygenSaturation: formattedSpO2,
        spo2: formattedSpO2,
        bloodPressure: formattedBp,
        bpReading: formattedBp,
        weight: formattedWeight,
        triageNotes: editNotes.trim() || undefined,
        receptionNotes: editNotes.trim() || undefined,
        lastEditedBy: 'DOCTOR' as const,
        submittedAt: editingToken.preConsultationNotes?.submittedAt || new Date().toISOString(),
      };

      const response = await fetch(`/api/staff/queue/${encodeURIComponent(editingToken.id)}/details`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: editName.trim(), patientPhone: editPhone.trim(), patientAge: Number(editAge) || undefined,
          patientGender: editGender, weight: formattedWeight, temperature: formattedTemp,
          oxygenSaturation: formattedSpO2, bloodPressure: formattedBp,
          triageNotes: editNotes.trim() || undefined, preConsultationNotes: updatedPreNotes,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to update patient details.');

      showToast(`Updated details & symptoms for #${editingToken.tokenNumber} (${editName})`);
      setEditingToken(null);
    } catch (err) {
      console.error('Error saving patient edits:', err);
      showToast('Failed to save patient details. Please retry.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const timingOptions = Array.from(new Set(tokens.map((token) => token.scheduledSlot).filter(Boolean))) as string[];
  const scopedTokens = selectedScheduledSlot === 'ALL' ? tokens : tokens.filter((token) => token.scheduledSlot === selectedScheduledSlot);

  // Filter queues
  const activeToken = scopedTokens.find(t => (
    t.status === 'CALLED' || t.status === 'SERVING' || t.status === 'IN_CONSULTATION'
  ));
  const waitingTokens = scopedTokens.filter(t => t.status === 'WAITING');
  const completedTokens = scopedTokens.filter(t => t.status === 'COMPLETED');
  const holdTokens = scopedTokens.filter(t => t.status === 'HOLD');

  const averageWaitSummary = getAverageWaitSummary(clinic.doctorStatus, waitingTokens);
  const averageWaitMinutes = averageWaitSummary.averageWaitMinutes;

  const currentPatients = scopedTokens.filter(t => t.status !== 'CANCELLED' && t.status !== 'NO_SHOW');
  const totalPatientsToday = currentPatients.length;
  const tokenRevenue = scopedTokens.reduce((total, token) => (
    token.paymentStatus === 'PAID' && token.status !== 'CANCELLED' && token.status !== 'NO_SHOW'
      ? total + (Number(token.amountPaid || 0) > 0
        ? Number(token.amountPaid || 0) - (token.paymentMode === 'PAY_NOW' ? 25 : 0)
        : Number(clinic.consultationFee || 0))
      : token.status === 'COMPLETED' ? total + Number(clinic.consultationFee || 0)
      : total
  ), 0);
  const reportedRevenue = Number(clinic.revenueToday || 0);
  const totalRevenue = Math.max(Number.isFinite(reportedRevenue) ? reportedRevenue : 0, tokenRevenue);

  // Active consultation duration timer
  useEffect(() => {
    if (!activeToken || !activeToken.calledAt) {
      setElapsedSeconds(0);
      return;
    }
    const calledTime = new Date(activeToken.calledAt).getTime();
    const updateTimer = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((now - calledTime) / 1000));
      setElapsedSeconds(diff);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [activeToken]);

  // Complete consultation and advance queue
  const handleCompleteConsultation = async () => {
    if (!activeToken && !nextToken) return;
    setIsSavingNotes(true);
    try {
      const action = getDoctorQueueAction({ activeToken, nextToken });

      if (activeToken && action !== 'CALL_NEXT') {
        if (activeToken.status === 'CALLED') {
          const startResponse = await fetch(`/api/staff/queue/${encodeURIComponent(activeToken.id)}/start`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
          });
          const startPayload = await startResponse.json();
          if (!startResponse.ok) throw new Error(startPayload.error || 'Unable to start consultation.');
        }

        const response = await fetch(`/api/staff/queue/${encodeURIComponent(activeToken.id)}/complete`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to complete consultation.');
      }

      if (nextToken) {
        const response = await fetch(`/api/staff/queue/${encodeURIComponent(nextToken.id)}/call`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to call the next token.');

        soundManager.announceToken(nextToken.tokenNumber, nextToken.patientName, clinic.cabinNumber);
        showToast(`Called Token #${nextToken.tokenNumber} (${nextToken.patientName}) to Cabin!`);
      } else {
        showToast('Consultation completed successfully.');
      }

    } catch (err) {
      console.error('Failed to advance consultation queue:', err);
      showToast('Failed to advance queue. Please check the connection and try again.');
    } finally {
      setIsSavingNotes(false);
    }
  };

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remSecs.toString().padStart(2, '0')}`;
  };

  const nextToken = [...waitingTokens].sort((a, b) => {
    const pA = a.priority ?? 10;
    const pB = b.priority ?? 10;
    if (pA !== pB) return pA - pB;
    return (a.sequenceNumber || 0) - (b.sequenceNumber || 0);
  })[0];
  const calledToken = tokens.find(t => t.status === 'CALLED');

  const handleCallNextToken = async () => {
    if (activeToken || !nextToken) return;
    const response = await fetch(`/api/staff/queue/${encodeURIComponent(nextToken.id)}/call`, {
      method: 'POST',
      credentials: 'include',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Unable to call next token.');
  };

  const handleStartConsultation = async () => {
    if (activeToken || !calledToken) return;
    const response = await fetch(`/api/staff/queue/${encodeURIComponent(calledToken.id)}/start`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || 'Unable to start consultation.');
    }
  };

  const handleHoldConsultation = async () => {
    if (!activeToken) return;
    const response = await fetch(`/api/staff/queue/${encodeURIComponent(activeToken.id)}/hold`, {
      method: 'POST',
      credentials: 'include',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Unable to hold consultation.');
  };

  const handleAddDelay = async () => {
    const delaySteps = [0, 5, 10, 15, 30];
    const currentDelay = clinic.delayMinutes || 0;
    const index = delaySteps.indexOf(currentDelay);
    const nextDelay = index >= 0
      ? delaySteps[index + 1] ?? currentDelay
      : delaySteps.find((step) => step > currentDelay) ?? currentDelay;
    const response = await fetch(`/api/staff/clinic/${encodeURIComponent(clinic.id)}/delay`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delayMinutes: nextDelay, delayReason: clinic.delayReason || '' }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Unable to update clinic delay.');
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-3 pb-6 sm:px-4 lg:px-0">
      {timingOptions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
          <span className="mr-1 text-xs font-bold uppercase tracking-wider text-slate-400">Timing</span>
          {['ALL', ...timingOptions].map((slot) => (
            <button key={slot} type="button" onClick={() => setSelectedScheduledSlot(slot)} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${selectedScheduledSlot === slot ? 'bg-teal-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
              {slot === 'ALL' ? 'All timings' : slot}
            </button>
          ))}
        </div>
      )}
      {/* Metrics Row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-5">

        {/* Doctor Profile */}
        <div className="relative min-w-0 overflow-hidden rounded-2xl border border-teal-500/25 bg-gradient-to-br from-slate-900 via-slate-900 to-teal-950/30 p-4 shadow-lg sm:col-span-2 lg:col-span-1">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-teal-400 via-emerald-400 to-transparent" />
          <div className="flex min-w-0 items-start gap-3 pt-1">
            <div className="flex aspect-square h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-950 p-0.5 text-teal-400 ring-1 ring-teal-400/50">
              {clinic.doctorPhoto ? <img src={clinic.doctorPhoto} alt={clinic.doctorName || 'Doctor'} className="block h-full w-full object-cover object-center" /> : <Stethoscope className="h-7 w-7" />}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-base font-bold leading-tight text-white">{formatDoctorName(clinic.doctorName)}</h2>
              <p className="mt-1 break-words text-xs leading-snug text-slate-400">{clinic.specialty || 'General Practice'}</p>
              <div className="mt-3 flex min-w-0 items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${clinic.doctorStatus === 'IN' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${clinic.doctorStatus === 'IN' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                  {clinic.doctorStatus === 'IN' ? 'Available' : 'Not checked in'}
                </span>
              </div>
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                <span className="whitespace-nowrap text-[10px] font-mono leading-snug text-slate-500">
                  {roomNumber ? `Room ${roomNumber}` : 'No room number'}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingRoomNumber((value) => !value)}
                  className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-[10px] font-bold text-teal-300 transition hover:border-teal-400/50 hover:bg-slate-800"
                >
                  {editingRoomNumber ? 'Close' : 'Edit room'}
                </button>
              </div>
              {editingRoomNumber && (
                <div className="mt-2 flex w-full items-center gap-2">
                    <input
                      value={roomNumber}
                      onChange={(e) => setRoomNumber(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-white outline-none focus:border-teal-300"
                      placeholder="Room / cabin"
                    />
                    <button
                      type="button"
                      onClick={handleSaveRoomNumber}
                      disabled={isSavingRoomNumber}
                      className="rounded bg-teal-500 px-2 py-1 text-[10px] font-black text-slate-950 disabled:opacity-50"
                    >
                      {isSavingRoomNumber ? '...' : 'Save'}
                    </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Metric 1: Total Patients Today */}
        <button
          type="button"
          onClick={() => setIsPatientListOpen(true)}
          className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-4 text-left shadow-lg transition hover:border-blue-400/40 hover:bg-slate-800/80 focus:outline-none focus:ring-2 focus:ring-blue-500"
          title="View all patient details"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Patients</span>
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-black text-white">{totalPatientsToday}</span>
            <span className="text-xs text-slate-400">
              <span className="text-emerald-400 font-bold">{completedTokens.length}</span> done
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500 flex items-center gap-1">
            <span>{waitingTokens.length} in queue</span>
            <span>•</span>
            <span>{holdTokens.length} on hold</span>
          </div>
        </button>

        {/* Metric 2: Current Running Token */}
        <div className="bg-gradient-to-br from-teal-950/40 to-slate-900 border border-teal-500/30 rounded-2xl p-4 sm:p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-teal-300 uppercase tracking-wider">Active Token</span>
            <div className="p-2 rounded-xl bg-teal-500/20 text-teal-300">
              <Activity className="w-4 h-4 animate-pulse" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-black text-teal-300">
              {activeToken ? activeToken.tokenNumber : 'None'}
            </span>
            {activeToken && (
              <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-teal-500/20 text-teal-200 border border-teal-500/30">
                {formatTimer(elapsedSeconds)}
              </span>
            )}
          </div>
          <div className="mt-2 text-xs text-slate-400 truncate">
            {activeToken ? activeToken.patientName : 'No patient in cabin right now'}
          </div>
        </div>

        {/* Metric 3: Average Wait Time */}
        <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-4 sm:p-5 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Avg Wait</span>
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-black text-white">
              {averageWaitSummary.label}
            </span>
            {averageWaitSummary.suffix ? <span className="text-xs text-slate-400">{averageWaitSummary.suffix}</span> : null}
          </div>
          <div className="mt-2 text-xs text-slate-500">{clinic.doctorStatus === 'IN' ? 'Queue pacing' : 'Doctor not in yet'}</div>
        </div>

        {/* Metric 4: Today's Revenue */}
        <div className="overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-slate-900 to-emerald-950/30 p-4 shadow-lg sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">Clinic Revenue</span>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <IndianRupee className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 min-w-0">
            <span className="block truncate text-2xl font-black leading-none text-emerald-400 sm:text-3xl">
              ₹{totalRevenue.toLocaleString('en-IN')}
            </span>
            <span className="mt-2 block text-xs font-medium text-emerald-300/90">Collected today</span>
          </div>
          <div className="mt-3 border-t border-emerald-500/10 pt-2 text-xs text-slate-400">
            Avg fee: ₹{clinic.consultationFee} per patient
          </div>
        </div>

      </div>

      {/* Main Consultation Desk Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left 7 Columns: Active Patient In Cabin & Clinical Prescription Notes */}
        <div className="lg:col-span-12 grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.85fr)]">
          <div className="h-full bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <span className="w-3 h-3 rounded-full bg-teal-400 animate-ping" />
                <h2 className="text-lg font-bold text-white">Active Consultation In Cabin</h2>
              </div>
              {activeToken && (
                <div className="flex items-center space-x-2 bg-slate-800 px-3 py-1 rounded-full text-xs font-mono text-teal-300 border border-slate-700">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Time Elapsed: {formatTimer(elapsedSeconds)}</span>
                </div>
              )}
            </div>

            {activeToken ? (
              <div className="mt-5 space-y-5">
                {/* Patient Summary Header */}
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xl font-bold text-white">{activeToken.patientName}</span>
                      {activeToken.isEmergency && (
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                          EMERGENCY
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                        {activeToken.tokenType}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-3">
                      <span>Phone: {activeToken.patientPhone}</span>
                      {activeToken.patientAge && <span>Age: {activeToken.patientAge}y</span>}
                      {activeToken.patientGender && <span>Gender: {activeToken.patientGender}</span>}
                    </p>
                  </div>

                  <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2">
                    <div className="text-right">
                      <span className="text-xs text-slate-500 block">Token ID</span>
                      <span className="text-2xl font-black text-teal-400 tracking-wider">
                        {activeToken.tokenNumber}
                      </span>
                    </div>
                    <button
                      onClick={() => openEditModal(activeToken)}
                      className="px-2.5 py-1.5 rounded-lg bg-teal-500/15 hover:bg-teal-500/25 text-teal-300 border border-teal-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      title="Edit patient name, phone, symptoms, and vitals"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-teal-400" />
                      <span>Edit Patient</span>
                    </button>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button
                    onClick={handleCompleteConsultation}
                    disabled={isSavingNotes}
                    className="flex-1 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-slate-950 font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-teal-500/20 transition-all flex items-center justify-center space-x-2 text-sm"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    <span>Complete Consultation & Call Next Token</span>
                  </button>

                  <button
                    onClick={() => soundManager.announceToken(activeToken.tokenNumber, activeToken.patientName, clinic.cabinNumber)}
                    className="px-4 py-3.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl border border-slate-700 text-xs font-semibold flex items-center justify-center space-x-1.5"
                    title="Re-announce token on waiting room speakers"
                  >
                    <Volume2 className="w-4 h-4 text-teal-400" />
                    <span>Re-Announce</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-16 px-4">
                <div className="w-16 h-16 rounded-full bg-slate-800/80 border border-slate-700 flex items-center justify-center mx-auto text-slate-500 mb-4">
                  <Stethoscope className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold text-slate-200">No Patient Currently In Cabin</h3>
                <p className="text-sm text-slate-400 max-w-md mx-auto mt-1">
                  {waitingTokens.length > 0
                    ? `${waitingTokens.length} patient(s) waiting in queue. Call the next patient${clinic.cabinNumber ? ` into Room ${clinic.cabinNumber}` : ''}.`
                    : 'The queue is currently empty. Patients will appear as they book online or check in at the reception desk.'}
                </p>

                {waitingTokens.length > 0 && (
                  <button
                    onClick={handleCompleteConsultation}
                    className="mt-6 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold py-3 px-6 rounded-xl shadow-lg transition-all inline-flex items-center space-x-2 text-sm"
                  >
                    <Activity className="w-4 h-4" />
                    <span>Call Next Patient ({waitingTokens[0]?.tokenNumber})</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Upcoming Queue Preview */}
          <div className="flex h-full min-h-0 flex-col bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Users className="w-4 h-4 text-teal-400" />
                Next Up In Queue
              </h3>
              <span className="shrink-0 rounded-full bg-teal-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-teal-300">
                {waitingTokens.length} waiting
              </span>
            </div>

            <div className="mt-4 min-h-0 flex-1 divide-y divide-slate-800/80">
              {waitingTokens.length > 0 ? (
                waitingTokens.slice(0, 5).map((tok, idx) => (
                  <div key={tok.id} className="group flex items-center justify-between gap-3 rounded-xl border border-transparent px-2 py-3 transition-colors hover:border-slate-700 hover:bg-slate-800/50">
                    <div className="flex items-center space-x-3">
                      <span className="w-6 text-xs font-mono font-bold text-slate-500">#{idx + 1}</span>
                      <span className="font-bold text-sm text-teal-300 font-mono bg-teal-950/40 px-2 py-0.5 rounded border border-teal-500/20">
                        {tok.tokenNumber}
                      </span>
                      <div>
                        <div className="text-sm font-semibold text-slate-200">{tok.patientName}</div>
                        <div className="text-xs text-slate-500">
                          {tok.tokenType} - {tok.patientAge ? `${tok.patientAge}y` : 'Adult'}
                          <span className={tok.paymentStatus === 'PAID' ? 'text-emerald-400' : 'text-amber-300'}> - {tok.paymentStatus === 'PAID' ? 'Paid' : 'Payment pending'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      {tok.isEmergency && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                          EMERGENCY
                        </span>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-6 text-slate-500 text-xs">
                  No upcoming patients waiting in queue.
                </div>
              )}
            </div>
          </div>
        </div>

        
      </div>

      {isPatientListOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6">
          <div className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl sm:max-h-[calc(100vh-3rem)]">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/95 px-4 py-4 sm:px-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-blue-300">Today&apos;s queue</p>
                <h2 className="mt-1 text-xl font-bold text-white sm:text-2xl">All patient details</h2>
                <p className="mt-1 text-xs text-slate-400">{currentPatients.length} patient{currentPatients.length === 1 ? '' : 's'} in this timing view</p>
              </div>
              <button
                type="button"
                onClick={() => setIsPatientListOpen(false)}
                className="rounded-lg bg-slate-800 p-2 text-slate-400 transition hover:text-white"
                aria-label="Close patient list"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5">
              {currentPatients.length > 0 ? currentPatients.map((token) => {
                const canDelete = token.status === 'WAITING' || token.status === 'HOLD';
                return (
                  <div key={token.id} className="mb-3 flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-slate-700 hover:bg-slate-950 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-base font-bold text-white">{token.patientName}</span>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${token.status === 'COMPLETED' ? 'bg-emerald-500/15 text-emerald-300' : token.status === 'HOLD' ? 'bg-amber-500/15 text-amber-300' : 'bg-blue-500/15 text-blue-300'}`}>
                          {token.status.replaceAll('_', ' ')}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                        <span className="font-mono font-bold text-teal-300">#{token.tokenNumber}</span>
                        <span>{token.patientPhone}</span>
                        {token.patientAge ? <span>{token.patientAge} years</span> : null}
                        {token.patientGender ? <span>{token.patientGender}</span> : null}
                      </div>
                      {token.scheduledSlot && <span className="mt-2 inline-flex rounded-full border border-blue-400/20 bg-blue-400/10 px-2.5 py-1 text-[10px] font-semibold text-blue-200">{token.scheduledSlot}</span>}
                    </div>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDeleteConsultation(token)}
                        disabled={isDeletingPatient}
                        className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50 sm:self-center"
                        title="Delete consultation if patient did not arrive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    )}
                  </div>
                );
              }) : (
                <p className="py-8 text-center text-sm text-slate-400">No active patient records for today.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Doctor Full Patient & Symptoms Editor Modal */}
      {editingToken && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-xl w-full p-6 sm:p-7 shadow-2xl space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-xl bg-teal-500/10 text-teal-400">
                  <Edit3 className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-xs font-mono font-bold text-teal-400">
                    TOKEN #{editingToken.tokenNumber}
                  </span>
                  <h3 className="text-lg font-bold text-white">
                    Edit Patient Details & Symptoms
                  </h3>
                </div>
              </div>

              <button
                onClick={() => setEditingToken(null)}
                className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePatientEdits} className="space-y-4">
              
              {/* Patient Demographics */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1">
                    Patient Name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    required
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:ring-2 focus:ring-teal-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1">
                    Phone Number <span className="text-rose-400">*</span>
                  </label>
                  <PhoneInput value={editPhone} onChange={setEditPhone} className="rounded-xl border-slate-800 bg-slate-950 text-xs" />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1">
                    Age
                  </label>
                  <input
                    type="number"
                    value={editAge}
                    onChange={(e) => setEditAge(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:ring-2 focus:ring-teal-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1">
                    Gender
                  </label>
                  <select
                    value={editGender}
                    onChange={(e) => setEditGender(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:ring-2 focus:ring-teal-500 focus:outline-none"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              {/* Symptoms / Chief Complaint */}
              <div>
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1">
                  Chief Complaint / Symptoms <span className="text-rose-400">*</span>
                </label>
                <textarea
                  required
                  rows={2}
                  value={editSymptoms}
                  onChange={(e) => setEditSymptoms(e.target.value)}
                  placeholder="e.g. Acute high fever with throat irritation and fatigue"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:ring-2 focus:ring-teal-500 focus:outline-none resize-none"
                />
              </div>

              {/* Duration & Severity & Pain Scale */}
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="text-[11px] text-slate-400 font-medium block mb-1">
                    Duration
                  </label>
                  <input
                    type="text"
                    value={editDuration}
                    onChange={(e) => setEditDuration(e.target.value)}
                    placeholder="e.g. 3 days"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white focus:ring-2 focus:ring-teal-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 font-medium block mb-1">
                    Severity
                  </label>
                  <select
                    value={editSeverity}
                    onChange={(e) => setEditSeverity(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white focus:ring-2 focus:ring-teal-500 focus:outline-none"
                  >
                    <option value="Mild">Mild</option>
                    <option value="Moderate">Moderate</option>
                    <option value="Severe">Severe</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 font-medium block mb-1 flex items-center justify-between">
                    <span>Pain Scale</span>
                    <span className="text-teal-300 font-bold">{editPainScale}/10</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    value={editPainScale}
                    onChange={(e) => setEditPainScale(Number(e.target.value))}
                    className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-400 mt-2"
                  />
                </div>
              </div>

              {/* Vitals with predefined units */}
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
                      value={editWeight}
                      onChange={(e) => setEditWeight(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 pl-3 pr-10 text-xs text-white placeholder-slate-600 focus:ring-2 focus:ring-teal-500 focus:outline-none font-mono"
                    />
                    <span className="absolute right-3 text-xs font-bold text-teal-400 select-none pointer-events-none">
                      kg
                    </span>
                  </div>
                </div>

                {/* Temperature in Fahrenheit */}
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
                      value={editTemp}
                      onChange={(e) => setEditTemp(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 pl-3 pr-10 text-xs text-white placeholder-slate-600 focus:ring-2 focus:ring-teal-500 focus:outline-none font-mono"
                    />
                    <span className="absolute right-3 text-xs font-bold text-amber-400 select-none pointer-events-none">
                      F
                    </span>
                  </div>
                </div>

                {/* Oxygen saturation */}
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
                      value={editSpO2}
                      onChange={(e) => setEditSpO2(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 pl-3 pr-10 text-xs text-white placeholder-slate-600 focus:ring-2 focus:ring-teal-500 focus:outline-none font-mono"
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
                        value={editBpSys}
                        onChange={(e) => setEditBpSys(e.target.value)}
                        title="Systolic (SYS)"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white text-center placeholder-slate-600 focus:ring-2 focus:ring-teal-500 focus:outline-none font-mono"
                      />
                    </div>
                    <span className="text-slate-500 font-black text-sm select-none">/</span>
                    <div className="flex-1">
                      <input
                        type="number"
                        placeholder="80"
                        value={editBpDia}
                        onChange={(e) => setEditBpDia(e.target.value)}
                        title="Diastolic (DIA)"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white text-center placeholder-slate-600 focus:ring-2 focus:ring-teal-500 focus:outline-none font-mono"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Allergies */}
              <div>
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1">
                  Known Allergies (Penicillin, Sulfa, Dust, etc.)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Penicillin, Peanuts, Pollen"
                  value={editAllergies}
                  onChange={(e) => setEditAllergies(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
              </div>

              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingToken(null)}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="flex-1 py-3 bg-teal-500 hover:bg-teal-400 text-slate-950 rounded-xl text-xs font-black shadow-lg shadow-teal-500/20 flex items-center justify-center gap-1.5"
                >
                  <Save className="w-4 h-4" />
                  <span>{isSavingEdit ? 'Updating...' : 'Save Patient Intake'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast alert */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-teal-500 text-slate-950 font-bold px-4 py-3 rounded-2xl shadow-2xl flex items-center space-x-2 text-xs animate-bounce">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
