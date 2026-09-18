import React, { useState, useEffect } from 'react';
import { Users, Plus, Edit, Trash2, Search, Upload } from 'lucide-react';
import { db, collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, recordAuditEvent } from '../lib/firebase';
import { PhoneInput } from '../components/PhoneInput';
import { formatDoctorName } from '../lib/doctorName';

interface Doctor {
  id: string;
  name: string;
  specialization: string;
  clinicId: string;
  qualification: string;
  experience: string;
  phone: string;
  email: string;
  photo?: string;
  bio?: string;
  consultationFee: number;
  availableDays: string[];
  availableHours: string;
  rating: number;
  status: 'active' | 'inactive';
  createdAt: string;
}

interface DoctorManagementProps {
  clinicId: string;
  clinicName: string;
  onBack: () => void;
}

const isValidPhotoDataUrl = (value: string) => /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 65000;

type TimePart = 'hour' | 'minute' | 'meridian';
type TimeParts = { hour: string; minute: string; meridian: string };

const parseTimeParts = (value: string): TimeParts => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return { hour: '', minute: '', meridian: '' };
  return { hour: match[1], minute: match[2], meridian: match[3].toUpperCase() };
};

const formatTimeParts = (parts: TimeParts) =>
  parts.hour || parts.minute || parts.meridian
    ? `${parts.hour || '12'}:${parts.minute || '00'} ${parts.meridian || 'AM'}`
    : '';

const parseAvailableWindows = (value: string) => String(value || '')
  .split(',')
  .map((window) => window.trim().match(/^(\d{1,2}:\d{2}\s*(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM))$/i))
  .filter((match): match is RegExpMatchArray => Boolean(match))
  .map((match) => ({ start: match[1], end: match[2] }));

const buildAvailableHours = (start: string, end: string, start2: string, end2: string) =>
  [[start, end], [start2, end2]]
    .filter(([windowStart, windowEnd]) => windowStart && windowEnd)
    .map(([windowStart, windowEnd]) => `${windowStart} - ${windowEnd}`)
    .join(', ');

const emptyDoctorForm = {
  name: '',
  specialization: '',
  qualification: '',
  experience: '',
  phone: '',
  email: '',
  photo: '',
  bio: '',
  consultationFee: '',
  availableDays: [] as string[],
  availableHours: '',
  availableStart: '',
  availableEnd: '',
  availableStart2: '',
  availableEnd2: '',
  status: 'active' as 'active' | 'inactive'
};

export const DoctorManagement: React.FC<DoctorManagementProps> = ({ clinicId, clinicName, onBack }) => {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingDoctor, setEditingDoctor] = useState<Doctor | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState(emptyDoctorForm);

  useEffect(() => {
    fetchDoctors();
  }, [clinicId]);

  const fetchDoctors = async () => {
    try {
      const q = query(collection(db, 'doctors'), where('clinicId', '==', clinicId));
      const snapshot = await getDocs(q);
      const doctorList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Doctor[];
      setDoctors(doctorList);
    } catch (error) {
      console.error('Error fetching doctors:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDoctor = async () => {
    try {
      const doctorData: Record<string, unknown> = {
        ...formData,
        clinicId,
        consultationFee: parseInt(formData.consultationFee),
        rating: editingDoctor?.rating || 0
      };
      const isValidPhoto = !formData.photo || isValidPhotoDataUrl(formData.photo);
      if (!isValidPhoto) {
        delete doctorData.photo;
      }

      if (editingDoctor) {
        await updateDoc(doc(db, 'doctors', editingDoctor.id), {
          ...doctorData,
          updatedAt: new Date().toISOString()
        });
        void recordAuditEvent('Doctor modified', `${doctorData.name} was modified for ${clinicName}.`);
      } else {
        const password = window.prompt('Set the doctor login password (at least 12 characters):', '');
        if (!password) return;
        if (password.length < 12) {
          window.alert('Password must be at least 12 characters.');
          return;
        }
        const response = await fetch('/api/admin/doctors', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...doctorData, password }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || `Doctor creation failed (${response.status})`);
        void recordAuditEvent('Doctor added', `${doctorData.name} was added to ${clinicName}.`);
      }

      setShowAddModal(false);
      setEditingDoctor(null);
      setFormData({ ...emptyDoctorForm });
      fetchDoctors();
    } catch (error) {
      console.error('Error saving doctor:', error);
    }
  };

  const handlePhotoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const source = new Image();
      source.onload = () => {
        const maxDimension = 512;
        const scale = Math.min(1, maxDimension / Math.max(source.width, source.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(source.width * scale));
        canvas.height = Math.max(1, Math.round(source.height * scale));
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        let quality = 0.72;
        let compressedPhoto = canvas.toDataURL('image/jpeg', quality);
        while (compressedPhoto.length > 65000 && quality > 0.3) {
          quality -= 0.08;
          compressedPhoto = canvas.toDataURL('image/jpeg', quality);
        }
        setFormData((current) => ({ ...current, photo: compressedPhoto }));
      };
      source.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  };

  const handleDeleteDoctor = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this doctor?')) {
      try {
        await deleteDoc(doc(db, 'doctors', id));
        void recordAuditEvent('Doctor deleted', `${doctors.find((doctor) => doctor.id === id)?.name || 'Doctor'} was deleted from ${clinicName}.`);
        fetchDoctors();
      } catch (error) {
        console.error('Error deleting doctor:', error);
      }
    }
  };

  const handleEditDoctor = (doctor: Doctor) => {
    setEditingDoctor(doctor);
    const windows = parseAvailableWindows(doctor.availableHours);
    setFormData({
      name: doctor.name,
      specialization: doctor.specialization,
      qualification: doctor.qualification,
      experience: doctor.experience,
      phone: doctor.phone,
      email: doctor.email,
      photo: doctor.photo || '',
      bio: doctor.bio || '',
      consultationFee: doctor.consultationFee.toString(),
      availableDays: doctor.availableDays,
      availableHours: doctor.availableHours,
      availableStart: windows[0]?.start || '',
      availableEnd: windows[0]?.end || '',
      availableStart2: windows[1]?.start || '',
      availableEnd2: windows[1]?.end || '',
      status: doctor.status
    });
    setShowAddModal(true);
  };

  const updateAvailableTime = (field: 'availableStart' | 'availableEnd' | 'availableStart2' | 'availableEnd2', part: TimePart, value: string) => {
    const nextParts = { ...parseTimeParts(formData[field]), [part]: value };
    const nextTime = formatTimeParts(nextParts);
    const nextFormData = { ...formData, [field]: nextTime };
    setFormData({
      ...nextFormData,
      availableHours: buildAvailableHours(nextFormData.availableStart, nextFormData.availableEnd, nextFormData.availableStart2, nextFormData.availableEnd2),
    });
  };

  const filteredDoctors = doctors.filter(doctor =>
    doctor.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    doctor.specialization.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  return (
    <div className="min-h-screen text-white">
      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <button
          onClick={onBack}
          className="mb-6 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-emerald-400 hover:text-white"
        >
          ← Back to clinic list
        </button>

        {/* Page Title */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-3 mb-2">
            <Users className="w-8 h-8 text-emerald-400" />
            Doctors - {clinicName}
          </h1>
          <p className="text-slate-400">Manage doctors and staff for this clinic</p>
        </div>
        {/* Controls */}
        <div className="flex flex-col md:flex-row gap-4 mb-8 items-center justify-between">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search doctors..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white placeholder-slate-500 focus:border-emerald-400 focus:outline-none"
            />
          </div>
          <button
            onClick={() => {
              setEditingDoctor(null);
              setFormData({ ...emptyDoctorForm });
              setShowAddModal(true);
            }}
            className="px-6 py-2 bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-lg font-semibold hover:shadow-lg hover:shadow-emerald-500/50 flex items-center gap-2 transition"
          >
            <Plus className="w-5 h-5" />
            Add Doctor
          </button>
        </div>

        {/* Doctors Grid */}
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <p className="text-slate-400">Loading doctors...</p>
          </div>
        ) : filteredDoctors.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-16 h-16 text-slate-600 mx-auto mb-4 opacity-50" />
            <p className="text-slate-400 mb-6">No doctors found</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-6 py-2 bg-emerald-500 rounded-lg font-semibold hover:bg-emerald-600"
            >
              Add First Doctor
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredDoctors.map(doctor => (
              <div key={doctor.id} className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden hover:border-emerald-400/50 transition group">
                {/* Doctor Image Placeholder */}
                <div className="h-40 bg-gradient-to-br from-emerald-900/30 to-cyan-900/30 flex items-center justify-center">
                  {doctor.photo && isValidPhotoDataUrl(doctor.photo) ? <img src={doctor.photo} alt={doctor.name} className="h-full w-full object-cover" /> : <Users className="w-20 h-20 text-slate-600" />}
                </div>

                <div className="p-6">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <h3 className="text-xl font-bold group-hover:text-emerald-400 transition">{formatDoctorName(doctor.name)}</h3>
                      <p className="text-sm text-emerald-400">{doctor.specialization}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditDoctor(doctor)}
                        className="p-2 bg-blue-500/20 hover:bg-blue-500/30 rounded-lg transition"
                      >
                        <Edit className="w-4 h-4 text-blue-400" />
                      </button>
                      <button
                        onClick={() => handleDeleteDoctor(doctor.id)}
                        className="p-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg transition"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm mb-4">
                    <p className="text-slate-300">{doctor.qualification}</p>
                    <p className="text-slate-400">{doctor.experience} years experience</p>
                    <p className="text-slate-400">{doctor.phone} • {doctor.email}</p>
                    <p className="text-emerald-400 font-semibold">₹{doctor.consultationFee} per consultation</p>
                  </div>

                  <div className="flex gap-2">
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${doctor.status === 'active' ? 'bg-emerald-400/20 text-emerald-400' : 'bg-red-400/20 text-red-400'}`}>
                      {doctor.status.charAt(0).toUpperCase() + doctor.status.slice(1)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Add/Edit Doctor Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-slate-800 border border-slate-700 rounded-xl max-w-2xl w-full my-8">
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold">{editingDoctor ? 'Edit Doctor' : 'Add New Doctor'}</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            
            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1">Full Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                    placeholder="John Doe"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Specialization</label>
                  <input
                    type="text"
                    value={formData.specialization}
                    onChange={(e) => setFormData({ ...formData, specialization: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                    placeholder="Cardiology"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1">Qualification</label>
                  <input
                    type="text"
                    value={formData.qualification}
                    onChange={(e) => setFormData({ ...formData, qualification: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                    placeholder="MBBS, MD"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Experience (years)</label>
                  <input
                    type="text"
                    value={formData.experience}
                    onChange={(e) => setFormData({ ...formData, experience: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                    placeholder="10"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1">Phone</label>
                  <PhoneInput value={formData.phone} onChange={(phone) => setFormData({ ...formData, phone })} className="text-sm" />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold mb-1">Consultation Fee (₹)</label>
                  <input
                    type="number"
                    value={formData.consultationFee}
                    onChange={(e) => setFormData({ ...formData, consultationFee: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                    placeholder="500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Profile Photo</label>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-emerald-400">
                    <Upload className="h-4 w-4 text-emerald-400" />
                    <span>{formData.photo ? 'Change photo' : 'Upload photo'}</span>
                    <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                  </label>
                  {formData.photo && isValidPhotoDataUrl(formData.photo) && <img src={formData.photo} alt="Doctor profile preview" className="mt-2 h-16 w-16 rounded-lg border border-slate-600 object-cover" />}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Bio</label>
                <textarea
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none resize-none"
                  rows={2}
                  placeholder="Brief bio..."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Available Days</label>
                <div className="grid grid-cols-4 gap-2">
                  {daysOfWeek.map(day => (
                    <label key={day} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.availableDays.includes(day)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({
                              ...formData,
                              availableDays: [...formData.availableDays, day]
                            });
                          } else {
                            setFormData({
                              ...formData,
                              availableDays: formData.availableDays.filter(d => d !== day)
                            });
                          }
                        }}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">{day.slice(0, 3)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Available Hours</label>
                <div className="space-y-4 rounded-xl border border-slate-600 bg-slate-700 p-3">
                  {([
                    { label: 'First shift', start: 'availableStart' as const, end: 'availableEnd' as const },
                    { label: 'Second shift (optional)', start: 'availableStart2' as const, end: 'availableEnd2' as const },
                  ]).map((shift) => (
                    <div key={shift.label}>
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-300">{shift.label}</label>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {([['Opening', shift.start], ['Closing', shift.end]] as const).map(([label, field]) => {
                          const parts = parseTimeParts(formData[field]);
                          return (
                            <div key={field}>
                              <label className="mb-1 block text-xs text-slate-400">{label}</label>
                              <div className="flex gap-2">
                                <select
                                  value={parts.hour}
                                  onChange={(event) => updateAvailableTime(field, 'hour', event.target.value)}
                                  className="min-w-0 flex-1 bg-slate-800 border border-slate-600 rounded-lg px-2 py-2 text-white focus:border-emerald-400 focus:outline-none"
                                >
                                  <option value="">Hour</option>
                                  {Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => <option key={hour} value={String(hour)}>{hour}</option>)}
                                </select>
                                <select
                                  value={parts.minute}
                                  onChange={(event) => updateAvailableTime(field, 'minute', event.target.value)}
                                  className="min-w-0 flex-1 bg-slate-800 border border-slate-600 rounded-lg px-2 py-2 text-white focus:border-emerald-400 focus:outline-none"
                                >
                                  <option value="">Min</option>
                                  {['00', '15', '30', '45'].map((minute) => <option key={minute} value={minute}>{minute}</option>)}
                                </select>
                                <select
                                  value={parts.meridian}
                                  onChange={(event) => updateAvailableTime(field, 'meridian', event.target.value)}
                                  className="min-w-0 flex-1 bg-slate-800 border border-slate-600 rounded-lg px-2 py-2 text-white focus:border-emerald-400 focus:outline-none"
                                >
                                  <option value="">AM/PM</option>
                                  <option value="AM">AM</option>
                                  <option value="PM">PM</option>
                                </select>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    Saved schedule: <span className="font-semibold">{formData.availableHours || 'Select opening and closing times'}</span>
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'inactive' })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-emerald-400 focus:outline-none"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div className="border-t border-slate-700 px-6 py-4 flex gap-3">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingDoctor(null);
                  setFormData({ ...emptyDoctorForm });
                }}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDoctor}
                className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 rounded-lg font-semibold transition"
              >
                {editingDoctor ? 'Update' : 'Create'} Doctor
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
