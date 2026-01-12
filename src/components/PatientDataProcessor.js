import React, { useState, useEffect, useCallback, Fragment, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import Papa from 'papaparse';
import _ from 'lodash';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Bar, Cell, BarChart } from 'recharts';
import { Calendar, ChevronDown, ChevronUp, Activity, Clipboard, Pill, Stethoscope, ChevronRight, XIcon } from 'lucide-react';
import { MagnifyingGlassIcon, UserGroupIcon, ChartBarIcon, ClockIcon, CalendarIcon, MicrophoneIcon } from '@heroicons/react/24/outline';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { loadICDCodes, lookupICDCode } from '../utils/icdLookup';
import { supabase } from '../utils/supabase';

const MIN_SUMMARY_PANEL_WIDTH = 360;
const MAX_SUMMARY_PANEL_WIDTH = 900;
const MIN_SUMMARY_PANEL_HEIGHT = 360;
const MAX_SUMMARY_PANEL_HEIGHT = 900;

const weightPercentileLabels = {
  weight_p97th: '97th percentile',
  weight_p90th: '90th percentile',
  weight_p75th: '75th percentile',
  weight_p50th: '50th percentile',
  weight_p25th: '25th percentile',
  weight_p10th: '10th percentile',
  weight_p3rd: '3rd percentile'
};

const medicationColorMap = {
  'Pain/Fever': 'bg-blue-600',
  'Respiratory': 'bg-green-600',
  'Antibiotic': 'bg-purple-600',
  'Dermatological': 'bg-yellow-600',
  'Nutritional': 'bg-red-600',
  'Antifungal': 'bg-indigo-600',
  'Diagnostic': 'bg-gray-600',
  'Anti-inflammatory': 'bg-pink-600',
  'Psychiatric': 'bg-violet-600',
  'Allergic': 'bg-orange-600',
  'Gastrointestinal': 'bg-amber-600',
  'Neurological': 'bg-violet-600',
  'Other': 'bg-gray-600'
};

const TIMELINE_AXIS_STYLE = {
  marginLeft: '6rem',
  width: 'calc(100% - 6rem)'
};

const LAB_TIME_RANGE_LOOKUP = {
  all: null,
  '1y': 365,
  '6m': 180,
  '3m': 90
};

const getMedicationType = (name) => {
  const lowerName = name.toLowerCase();
  if (lowerName.includes('ibuprofen') || lowerName.includes('acetaminophen') || lowerName.includes('naproxen')) return 'Pain/Fever';
  if (lowerName.includes('albuterol') || lowerName.includes('montelukast') || lowerName.includes('fluticasone') || lowerName.includes('beclomethasone')) return 'Respiratory';
  if (lowerName.includes('amoxicillin') || lowerName.includes('cephalexin') || lowerName.includes('azithromycin') || lowerName.includes('clindamycin')) return 'Antibiotic';
  if (lowerName.includes('cream') || lowerName.includes('hydrocortisone') || lowerName.includes('benzoyl')) return 'Dermatological';
  if (lowerName.includes('fluoxetine') || lowerName.includes('guanfacine')) return 'Psychiatric';
  if (lowerName.includes('prednisone') || lowerName.includes('dexamethasone')) return 'Anti-inflammatory';
  if (lowerName.includes('loratadine') || lowerName.includes('cetirizine')) return 'Allergic';
  if (lowerName.includes('omeprazole') || lowerName.includes('polyethylene')) return 'Gastrointestinal';
  if (lowerName.includes('rizatriptan') || lowerName.includes('topiramate')) return 'Neurological';
  return 'Other';
};

const sanitizeFilename = (name) => {
  return name.replace(/[^a-z0-9_.-]/gi, '_');
};

const PatientDataProcessor = ({ currentUser }) => {
  const [patientData, setPatientData] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeSection, setActiveSection] = useState('timeline');
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState({ title: '', content: null });
  const [chatMessages, setChatMessages] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedVisitForLLM, setSelectedVisitForLLM] = useState(null);
  const [isLLMModalOpen, setIsLLMModalOpen] = useState(false);
  const [visitSummaryCount, setVisitSummaryCount] = useState(5);
  const [filteredPatients, setFilteredPatients] = useState([]);
  const [expandedSections, setExpandedSections] = useState({
    diagnosis: true,
    medications: true,
    labs: true,
    clinicalTimeline: true
  });
  const [selectedDiagnosis, setSelectedDiagnosis] = useState(null);
  const [selectedMedication, setSelectedMedication] = useState(null);
  const [selectedLab, setSelectedLab] = useState(null);
  const [viewMode, setViewMode] = useState('category');
  const [diagnosisTimelineView, setDiagnosisTimelineView] = useState('category');
  const [hoveredMed, setHoveredMed] = useState(null);
  const [hoveredLabTooltip, setHoveredLabTooltip] = useState(null);
  const [integratedTimelineTooltip, setIntegratedTimelineTooltip] = useState(null);
  const [hoveredCode, setHoveredCode] = useState(null); // Now stores { code, uniqueId, rect, description } or null
  const [icdCodesLoaded, setIcdCodesLoaded] = useState(false);
  // Add back lab-related state variables
  const [selectedLabCategory, setSelectedLabCategory] = useState('all');
  const [labTimeRange, setLabTimeRange] = useState('all');
  const [showReferenceRanges, setShowReferenceRanges] = useState(false);
  const [showAbnormalOnly, setShowAbnormalOnly] = useState(false);
  const [selectedLabTest, setSelectedLabTest] = useState('all');
  const [selectedLabComponents, setSelectedLabComponents] = useState([]); // For multi-select lab trends
  const [labTimelineSort, setLabTimelineSort] = useState('recent');
  const [isPhysicianSummaryPanelCollapsed, setIsPhysicianSummaryPanelCollapsed] = useState(true);
  const [physicianSummaryText, setPhysicianSummaryText] = useState('');
  const [physicianSummaryVisitCount, setPhysicianSummaryVisitCount] = useState(3);
  const [isDictating, setIsDictating] = useState(false);
  const [speechRecognition, setSpeechRecognition] = useState(null);
  const [isSavingPhysicianSummary, setIsSavingPhysicianSummary] = useState(false);
  const [physicianSummaryStatus, setPhysicianSummaryStatus] = useState(null);
  const [physicianSummaryMeta, setPhysicianSummaryMeta] = useState(null);
  const [summaryTimerStart, setSummaryTimerStart] = useState(null);
  const [summaryElapsedTime, setSummaryElapsedTime] = useState(0);
  const selectedPatientId = selectedPatient?.patientId;
  const [physicianSummaryPanelSize, setPhysicianSummaryPanelSize] = useState({
    width: 420,
    height: 520
  });
  const patientMaxAge = useMemo(() => {
    if (!selectedPatient?.visits?.length) return 0;
    return Math.max(...selectedPatient.visits.map(v => v.ageInDays || 0));
  }, [selectedPatient]);
  const [diagnosisTimelineSort, setDiagnosisTimelineSort] = useState('last');
  const [medicationTimelineSort, setMedicationTimelineSort] = useState('last');
  const [growthPercentiles, setGrowthPercentiles] = useState(null);
  const [problemTimelineSort, setProblemTimelineSort] = useState('last');
  const [visitTimelineSort, setVisitTimelineSort] = useState('desc'); // 'desc' = newest first, 'asc' = oldest first
  const [visitTimelineLimit, setVisitTimelineLimit] = useState('10'); // 'all' or '10' - default to last 10 visits
  
  // Track scroll state for gradient visibility
  const [scrolledToBottom, setScrolledToBottom] = useState({
    diagnosisTimeline: false,
    diagnosisTable: false,
    medicationTimeline: false,
    medicationTable: false,
    labsTable: false,
    problemsTable: false,
    problemTimeline: false,
    labTimeline: false,
    visualDiagnosis: false,
    visualMedication: false,
    visualLab: false,
    visitTimeline: false
  });
  
  // Track which elements have been checked for initial scroll state
  const checkedScrollRefs = React.useRef(new Set());
  
  // Handler to check if scrolled to bottom (or if no scrolling needed)
  const handleScroll = (e, key) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    // Consider "at bottom" if within 20px of bottom OR if content doesn't need scrolling
    const hasNoOverflow = scrollHeight <= clientHeight;
    const isAtBottom = hasNoOverflow || (scrollHeight - scrollTop - clientHeight < 20);
    setScrolledToBottom(prev => {
      if (prev[key] === isAtBottom) return prev; // No change needed
      return { ...prev, [key]: isAtBottom };
    });
  };
  
  // Check scroll state on initial render (for when content fits without scrolling)
  const checkInitialScrollState = useCallback((element, key) => {
    if (element && !checkedScrollRefs.current.has(key)) {
      checkedScrollRefs.current.add(key);
      const { scrollHeight, clientHeight } = element;
      const hasNoOverflow = scrollHeight <= clientHeight;
      if (hasNoOverflow) {
        setScrolledToBottom(prev => {
          if (prev[key] === true) return prev; // No change needed
          return { ...prev, [key]: true };
        });
      }
    }
  }, []);
  
  // Filtered visits based on the global limit setting
  const filteredVisits = useMemo(() => {
    if (!selectedPatient?.visits?.length) return [];
    let visits = [...selectedPatient.visits];
    if (visitTimelineLimit === '10') {
      // Sort by age descending to get the most recent, take 10
      visits = visits.sort((a, b) => b.ageInDays - a.ageInDays).slice(0, 10);
    }
    return visits;
  }, [selectedPatient?.visits, visitTimelineLimit]);
  const integratedTimelineRange = useMemo(() => {
    if (!filteredVisits.length) {
      return { start: 0, end: 0, span: 1 };
    }
    
    // Collect all ages from visits
    const allAges = filteredVisits
      .map(visit => visit.ageInDays)
      .filter(age => Number.isFinite(age));
    
    // Also include medication start/end ages
    filteredVisits.forEach(visit => {
      visit.medications?.forEach(med => {
        const startAge = parseInt(med.start);
        const endAge = med.end === 'ongoing' ? null : parseInt(med.end);
        if (Number.isFinite(startAge)) allAges.push(startAge);
        if (Number.isFinite(endAge)) allAges.push(endAge);
      });
      // Include lab ages
      visit.labs?.forEach(lab => {
        if (Number.isFinite(visit.ageInDays)) allAges.push(visit.ageInDays);
      });
    });
    
    if (!allAges.length) {
      return { start: 0, end: 0, span: 1 };
    }
    const start = Math.min(...allAges);
    const end = Math.max(...allAges);
    return {
      start,
      end,
      span: Math.max(1, end - start)
    };
  }, [filteredVisits]);
  const growthSparklineData = useMemo(() => {
    if (!filteredVisits.length) return [];
    return [...filteredVisits]
      .filter(visit => Number.isFinite(visit.ageInDays))
      .map(visit => {
        const rawWeight = Number(visit.weight);
        const rawHeight = Number(visit.height);
        const weight = Number.isFinite(rawWeight) && rawWeight > 0
          ? Number((rawWeight / 16).toFixed(1))
          : null;
        const height = Number.isFinite(rawHeight) && rawHeight > 0
          ? Number(rawHeight.toFixed ? rawHeight.toFixed(1) : rawHeight)
          : null;
        const bmi = weight != null && height != null
          ? Number(((weight * 703) / (height * height)).toFixed(1))
          : null;
        return {
          ageInDays: visit.ageInDays,
          weight,
          height,
          bmi
        };
      })
      .sort((a, b) => a.ageInDays - b.ageInDays);
  }, [filteredVisits]);

  const filteredLabResults = useMemo(() => {
    if (!filteredVisits.length) return [];
    const visits = filteredVisits;
    const ages = visits.map(v => v.ageInDays || 0);
    const maxAge = ages.length ? Math.max(...ages) : 0;
    const threshold = LAB_TIME_RANGE_LOOKUP[labTimeRange] ?? null;
    const results = [];
    let counter = 0;

    visits.forEach((visit, visitIdx) => {
      const visitAge = Number.isFinite(visit.ageInDays) ? visit.ageInDays : 0;
      (visit.labs || []).forEach((lab, labIdx) => {
        if (selectedLabCategory !== 'all' && lab.testCategory !== selectedLabCategory) {
          return;
        }
        if (showAbnormalOnly && !lab.flag) {
          return;
        }
        if (threshold != null && maxAge - visitAge > threshold) {
          return;
        }
        results.push({
          ...lab,
          ageInDays: visitAge,
          date: visit.date,
          uniqueKey: `${visit.visitId || visitIdx}-${lab.orderId || lab.testName || lab.component || 'lab'}-${labIdx}-${counter++}`
        });
      });
    });

    return results.sort((a, b) => {
      if ((a.testName || '') === (b.testName || '')) {
        return b.ageInDays - a.ageInDays;
      }
      return (a.testName || '').localeCompare(b.testName || '');
    });
  }, [filteredVisits, selectedLabCategory, showAbnormalOnly, labTimeRange]);

  const relevantLabResults = useMemo(() => {
    if (selectedLabTest === 'all') return filteredLabResults;
    return filteredLabResults.filter(lab => lab.testName === selectedLabTest);
  }, [filteredLabResults, selectedLabTest]);

  const labsTimelineRange = useMemo(() => {
    if (!filteredVisits.length) {
      return { start: 0, end: 0, span: 1 };
    }
    const visitAges = filteredVisits
      .map(visit => visit.ageInDays)
      .filter(age => Number.isFinite(age));
    if (!visitAges.length) {
      return { start: 0, end: 0, span: 1 };
    }
    let start = Math.min(...visitAges);
    let end = Math.max(...visitAges);
    const threshold = LAB_TIME_RANGE_LOOKUP[labTimeRange] ?? null;
    if (threshold != null) {
      start = Math.max(start, end - threshold);
    }
    if (start === end) {
      start = start - 15;
      end = end + 15;
    }
    return {
      start,
      end,
      span: Math.max(1, end - start)
    };
  }, [filteredVisits, labTimeRange]);

  const labTimelineRows = useMemo(() => {
    if (!relevantLabResults.length) return [];

    const grouped = _.groupBy(relevantLabResults, lab => {
      if (lab.testName && lab.component) {
        return `${lab.testName}:::${lab.component}`;
      }
      if (lab.testName) {
        return `test:::${lab.testName}`;
      }
      if (lab.component) {
        return `component:::${lab.component}`;
      }
      return lab.uniqueKey || `lab-${lab.ageInDays}`;
    });

    const rows = Object.entries(grouped).map(([groupKey, labs]) => {
      const sortedResults = labs.slice().sort((a, b) => a.ageInDays - b.ageInDays);
      const latest = sortedResults[sortedResults.length - 1];
      const earliest = sortedResults[0];
      const displayName = latest?.testName || earliest?.testName || latest?.component || earliest?.component || 'Lab';
      const componentName = latest?.component || earliest?.component;

      return {
        key: groupKey,
        testName: displayName,
        component: componentName && componentName !== displayName ? componentName : null,
        unit: latest?.unit || earliest?.unit,
        results: sortedResults,
        latestAge: latest?.ageInDays ?? 0,
        earliestAge: earliest?.ageInDays ?? 0
      };
    });

    return rows.sort((a, b) => {
      if (labTimelineSort === 'oldest') {
        return (a.earliestAge || 0) - (b.earliestAge || 0);
      }
      if (labTimelineSort === 'alpha') {
        return (a.testName || '').localeCompare(b.testName || '');
      }
      // default 'recent'
      return (b.latestAge || 0) - (a.latestAge || 0);
    });
  }, [relevantLabResults, labTimelineSort]);

  const labTrendSeries = useMemo(() => {
    const numericLabs = filteredLabResults
      .filter(lab => Number.isFinite(lab.numericValue));
    if (!numericLabs.length) return [];
    // Group by individual component (e.g., WBC, RBC, Hemoglobin) rather than category (e.g., CBC)
    const grouped = _.groupBy(numericLabs, lab => lab.component || lab.testName || 'Lab');
    return Object.entries(grouped).map(([componentName, labs]) => ({
      componentName,
      testCategory: labs[0]?.testName || 'Unknown',
      data: labs
        .slice()
        .sort((a, b) => a.ageInDays - b.ageInDays)
        .map(lab => ({
          ageInDays: lab.ageInDays,
          value: Number(lab.numericValue),
          flag: lab.flag,
          result: lab.result
        }))
    }));
  }, [filteredLabResults]);

  // Move processMultiPatientData outside useEffect for proper dependency handling
  const processMultiPatientData = useCallback((rawData) => {
    console.log("Processing raw data:", rawData[0]); // Log first row to see structure
    
    const groupedByPatient = _.groupBy(rawData, 'patient_id');
    
    return Object.keys(groupedByPatient).map(patientId => {
      const patientVisits = groupedByPatient[patientId];
      console.log("Processing patient:", patientId);
      console.log("First visit referrals_details:", patientVisits[0]?.referrals_details);
      
      const patientInfo = {
        patientId: patientId,  // Ensure we use the exact patient_id from the data
        sex: patientVisits[0]?.sex || 'Unknown',
        ethnicity: patientVisits[0]?.ethnicity || 'Unknown',
        race: patientVisits[0]?.race_1 || 'Unknown'
      };
      
      const visits = patientVisits.map(visit => {
        console.log("Visit referrals_details:", visit.referrals_details);
        return {
          visitId: visit.visit_id,
          ageInDays: visit.age_in_days || 0,
          encounterType: visit.encounter_type || 'Unknown',
          weight: visit.weight_oz || 0,
          height: visit.height_in || 0,
          date: new Date(parseInt(visit.age_in_days || 0) * 86400000),
          diagnoses: extractDiagnoses(visit),
          medications: extractMedications(visit.medications_details || ''),
          labs: extractLabs(visit.labs_details || ''),
          referrals_details: visit.referrals_details || ''
        };
      });
      
      return {
        ...patientInfo,
        visits: visits.sort((a, b) => a.ageInDays - b.ageInDays)
      };
    });
  }, []);

  // Update the useEffect to use the callback
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        console.log('Starting data load...');
        
        let response = await fetch('https://pjtvlhyapgpbvubxiqfg.supabase.co/storage/v1/object/sign/P3-Data/combined_visits_aggregated_dec_summarize_2025.csv?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9hODUwYmVkOC01NDFlLTQwM2QtOWYyYS05ZjA2NWYzMjRhNzEiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQMy1EYXRhL2NvbWJpbmVkX3Zpc2l0c19hZ2dyZWdhdGVkX2RlY19zdW1tYXJpemVfMjAyNS5jc3YiLCJpYXQiOjE3NjgyNDg1MjEsImV4cCI6MTc5OTc4NDUyMX0.g5zotMBsMfYqjyf3p_tU3eYDKiDlwHXz9lHP739lFLE');
        
        if (!response.ok) {
          console.log('Failed to load from public directory, trying absolute path...');
          response = await fetch('https://pjtvlhyapgpbvubxiqfg.supabase.co/storage/v1/object/sign/P3-Data/combined_visits_aggregated_dec_summarize_2025.csv?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9hODUwYmVkOC01NDFlLTQwM2QtOWYyYS05ZjA2NWYzMjRhNzEiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQMy1EYXRhL2NvbWJpbmVkX3Zpc2l0c19hZ2dyZWdhdGVkX2RlY19zdW1tYXJpemVfMjAyNS5jc3YiLCJpYXQiOjE3NjgyNDg1MjEsImV4cCI6MTc5OTc4NDUyMX0.g5zotMBsMfYqjyf3p_tU3eYDKiDlwHXz9lHP739lFLE');
        }

        if (!response.ok) {
          throw new Error(`Failed to fetch CSV file: ${response.statusText}`);
        }
        
        const csvText = await response.text();
        
        if (!csvText) {
          throw new Error('CSV file is empty');
        }
        
        Papa.parse(csvText, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: (results) => {
            console.log("CSV parsing complete");
            console.log("First row:", results.data[0]);
            console.log("Headers:", Object.keys(results.data[0]));
            console.log("Sample referrals_details:", results.data.slice(0, 5).map(row => row.referrals_details));
            
            if (results.data && results.data.length > 0) {
              // Slice to first 40 rows as requested
              const limitedData = results.data.slice(0, 1000);
              console.log(`Limiting data to first 40 rows (original: ${results.data.length})`);
              
              const processedData = processMultiPatientData(limitedData);
              setPatientData(processedData);
              setFilteredPatients(processedData);
            } else {
              setError('No data found in CSV file');
            }
            setIsLoading(false);
          },
          error: (error) => {
            console.error('Error parsing CSV:', error);
            setError(`Error parsing CSV: ${error.message}`);
            setIsLoading(false);
          }
        });
      } catch (error) {
        console.error('Error loading data:', error);
        setError(`Error loading data: ${error.message}`);
        setIsLoading(false);
      }
    };
    
    loadData();
  }, [processMultiPatientData]);

  useEffect(() => {
    const filtered = patientData.filter(patient => {
      const searchLower = searchQuery.toLowerCase();
      // First try exact match for patient ID
      if (patient.patientId === searchQuery) {
        return true;
      }
      // Then try partial matches
      return (
        patient.patientId.toLowerCase().includes(searchLower) ||
        (patient.sex?.toLowerCase() || '').includes(searchLower) ||
        (patient.ethnicity?.toLowerCase() || '').includes(searchLower)
      );
    });
    console.log('Filtered patients:', filtered.map(p => p.patientId));
    setFilteredPatients(filtered);
  }, [searchQuery, patientData]);

  useEffect(() => {
    if (!selectedPatientId) {
setPhysicianSummaryText('');
    setPhysicianSummaryMeta(null);
    setPhysicianSummaryStatus(null);
    setPhysicianSummaryVisitCount(3);
    setIsPhysicianSummaryPanelCollapsed(true);
    setSummaryTimerStart(null);
    setSummaryElapsedTime(0);
      return;
    }

    // Reset state first
    setPhysicianSummaryText('');
    setPhysicianSummaryMeta(null);
    setPhysicianSummaryStatus(null);
    setPhysicianSummaryVisitCount(3);
    setIsPhysicianSummaryPanelCollapsed(false);
    setSummaryTimerStart(null);
    setSummaryElapsedTime(0);

    // Try to load existing summary from Supabase (only for current user)
    const loadSavedSummary = async () => {
      if (!currentUser) return; // Don't load if no user is logged in
      
      try {
        const authorName = sanitizeFilename(currentUser);
        const { data, error } = await supabase
          .from('patient_summaries')
          .select('*')
          .eq('patient_id', selectedPatientId)
          .eq('author', authorName)
          .single();

        if (error && error.code !== 'PGRST116') {
          // PGRST116 means no rows found, which is fine
          console.log('Supabase load error:', error.message);
        }
        
        if (data && data.summary) {
          setPhysicianSummaryText(data.summary);
          setPhysicianSummaryMeta({
            savedAt: data.saved_at,
            author: data.author
          });
          setPhysicianSummaryStatus({
            type: 'success',
            message: `Loaded your saved summary from ${new Date(data.saved_at).toLocaleDateString()}`
          });
        }
      } catch (err) {
        // Supabase might have issues - that's okay, just start fresh
        console.log('Could not load saved summary:', err.message);
      }
    };

    loadSavedSummary();
  }, [selectedPatientId, currentUser]);

  const recentPhysicianVisits = useMemo(() => {
    if (!filteredVisits || filteredVisits.length === 0) {
      return [];
    }
    // Use all filtered visits (respects the global "All Visits" / "Last 10" filter)
    return [...filteredVisits]
      .sort((a, b) => (b.ageInDays || 0) - (a.ageInDays || 0));
  }, [filteredVisits]);

  // Timer effect - updates elapsed time every second when timer is running
  useEffect(() => {
    if (!summaryTimerStart) return;
    
    const interval = setInterval(() => {
      setSummaryElapsedTime(Math.floor((Date.now() - summaryTimerStart) / 1000));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [summaryTimerStart]);

  // Format elapsed time as MM:SS
  const formatElapsedTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Handler for when user starts typing - starts timer on first keystroke
  const handleSummaryTextChange = (e) => {
    const newText = e.target.value;
    setPhysicianSummaryText(newText);
    
    // Start timer on first keystroke (when going from empty to non-empty)
    if (!summaryTimerStart && newText.length > 0) {
      setSummaryTimerStart(Date.now());
    }
  };

  // Dictation toggle using Web Speech API
  const toggleDictation = () => {
    if (isDictating && speechRecognition) {
      // Stop dictation
      speechRecognition.stop();
      setIsDictating(false);
      return;
    }

    // Check if browser supports speech recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    // Start dictation
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = physicianSummaryText;

    recognition.onresult = (event) => {
      let interimTranscript = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += (finalTranscript ? ' ' : '') + transcript;
          setPhysicianSummaryText(finalTranscript);
          // Start timer if not already started
          if (!summaryTimerStart) {
            setSummaryTimerStart(Date.now());
          }
        } else {
          interimTranscript += transcript;
        }
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        alert('Microphone access was denied. Please allow microphone access to use dictation.');
      }
      setIsDictating(false);
    };

    recognition.onend = () => {
      setIsDictating(false);
    };

    recognition.start();
    setSpeechRecognition(recognition);
    setIsDictating(true);
  };

  const handlePhysicianSummarySubmit = async (event) => {
    event.preventDefault();
    if (!selectedPatient) {
      return;
    }
    setIsSavingPhysicianSummary(true);
    setPhysicianSummaryStatus(null);

    const visitsIncluded = recentPhysicianVisits.map((visit) => ({
      visitId: visit.visitId,
      ageInDays: visit.ageInDays,
      encounterType: visit.encounterType,
      visitDate:
        visit.date instanceof Date && !isNaN(visit.date.getTime())
          ? visit.date.toISOString().split('T')[0]
          : null
    }));

    try {
      const authorName = currentUser || 'unknown';
      const savedAt = new Date().toISOString();
      
      // Calculate final elapsed time
      const finalElapsedSeconds = summaryTimerStart 
        ? Math.floor((Date.now() - summaryTimerStart) / 1000)
        : 0;
      
      // Save to Supabase
      const { error } = await supabase
        .from('patient_summaries')
        .upsert({
          patient_id: selectedPatient.patientId,
          author: authorName,
          summary: physicianSummaryText,
          time_to_complete: finalElapsedSeconds,
          visits_included: visitsIncluded,
          saved_at: savedAt
        }, { onConflict: 'patient_id,author' });

      if (!error) {
        // Stop the timer
        setSummaryTimerStart(null);
        
        setPhysicianSummaryMeta({ savedAt, author: authorName, timeToComplete: finalElapsedSeconds });
      setPhysicianSummaryStatus({
        type: 'success',
          message: `✓ Saved to cloud (${formatElapsedTime(finalElapsedSeconds)}, ${recentPhysicianVisits.length} visits)`
      });
      } else {
        console.error('Supabase save error:', error);
        throw new Error(error.message || 'Failed to save');
      }
    } catch (error) {
      console.error('Failed to save physician summary:', error);
      setPhysicianSummaryStatus({
        type: 'error',
        message: 'Failed to save summary. Please try again.'
      });
    } finally {
      setIsSavingPhysicianSummary(false);
    }
  };

  const renderWeightTooltipContent = ({ active, label, payload }) => {
    if (!active || !payload || payload.length === 0) {
      return null;
    }

    const patientEntry = payload.find(item => item.dataKey === 'weight');
    const patientWeight = typeof patientEntry?.value === 'number' ? patientEntry.value : null;

    const percentileEntries = payload
      .filter(item => item.dataKey && item.dataKey.startsWith('weight_p'))
      .map(item => ({
        key: item.dataKey,
        label: weightPercentileLabels[item.dataKey] || item.dataKey,
        value: item.value
      }))
      .filter(item => typeof item.value === 'number')
      .sort((a, b) => a.value - b.value);

    let percentileBand = null;
    if (patientWeight != null && percentileEntries.length > 0) {
      for (let i = 0; i < percentileEntries.length - 1; i++) {
        const lower = percentileEntries[i];
        const upper = percentileEntries[i + 1];
        if (patientWeight >= lower.value && patientWeight <= upper.value) {
          percentileBand = `${lower.label} – ${upper.label}`;
          break;
        }
      }
      if (!percentileBand) {
        if (patientWeight < percentileEntries[0].value) {
          percentileBand = `Below ${percentileEntries[0].label}`;
        } else {
          percentileBand = `Above ${percentileEntries[percentileEntries.length - 1].label}`;
        }
      }
    }

    const referencePercentiles = ['weight_p90th', 'weight_p50th', 'weight_p10th']
      .map(key => percentileEntries.find(entry => entry.key === key))
      .filter(Boolean);

    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm space-y-3 max-w-xs">
        <div>
          <p className="text-xs uppercase text-gray-500">Age</p>
          <p className="text-base font-semibold text-gray-900">{formatAge(label)}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-gray-500">Patient Weight</p>
          <p className="text-2xl font-bold text-indigo-600">
            {patientWeight != null ? `${patientWeight.toFixed(1)} lbs` : 'Not recorded'}
          </p>
          {percentileBand && (
            <p className="text-xs text-gray-500 mt-1">Position: {percentileBand}</p>
          )}
        </div>
        {referencePercentiles.length > 0 && (
          <div>
            <p className="text-xs uppercase text-gray-500">Reference Percentiles</p>
            <div className="mt-1 space-y-1">
              {referencePercentiles.map((entry) => (
                <div key={entry.key} className="flex justify-between text-xs text-gray-600">
                  <span>{entry.label}</span>
                  <span>{entry.value.toFixed(1)} lbs</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderZScoreTooltip = (measurement = 'weight') => ({ active, label, payload }) => {
    if (!active || !payload || payload.length === 0) {
      return null;
    }

    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm space-y-2">
        <p className="text-xs uppercase text-gray-500">Age</p>
        <p className="text-base font-semibold text-gray-900">{formatAge(label)}</p>
        <div className="flex justify-between text-sm text-gray-700">
          <span>{measurement === 'weight' ? 'Weight' : 'Height'} Z-Score</span>
          <span className="font-semibold">{Number(payload[0].value).toFixed(2)}</span>
        </div>
      </div>
    );
  };

  const startSummaryPanelResize = (direction) => (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = physicianSummaryPanelSize.width;
    const startHeight = physicianSummaryPanelSize.height;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    const handleMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      setPhysicianSummaryPanelSize((prev) => {
        let newWidth = prev.width;
        let newHeight = prev.height;

        if (direction === 'left' || direction === 'corner') {
          newWidth = clamp(startWidth - deltaX, MIN_SUMMARY_PANEL_WIDTH, MAX_SUMMARY_PANEL_WIDTH);
        }
        if (direction === 'top' || direction === 'corner') {
          newHeight = clamp(startHeight - deltaY, MIN_SUMMARY_PANEL_HEIGHT, MAX_SUMMARY_PANEL_HEIGHT);
        }

        if (newWidth === prev.width && newHeight === prev.height) {
          return prev;
        }
        return { width: newWidth, height: newHeight };
      });
    };

    const stopResizing = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', stopResizing);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
  };

  const extractDiagnoses = (visit) => {
    const diagnoses = [];
    for (let i = 1; i <= 33; i++) {
      const diagCode = visit[`enc_diag_${i}`];
      if (diagCode && diagCode.trim() !== '') {
        diagnoses.push(diagCode);
      }
    }
    return diagnoses;
  };
  
  const extractMedications = (medicationsText) => {
    if (!medicationsText) return [];
    
    // Split by semicolon and filter out empty strings
    const medicationEntries = medicationsText.split(';')
      .map(entry => entry.trim())
      .filter(entry => entry && !entry.startsWith(';'));
    
    const medications = [];
    const medRegex = /([^(]+)\(order: (\d+), start: ([\d.]+), end: ([^,]+), type: ([^)]+)\)/;
    
    medicationEntries.forEach(entry => {
      const match = medRegex.exec(entry);
      if (match) {
        const name = match[1].trim();
        const startDays = parseFloat(match[3]);
        const endValue = match[4].trim();
        const endDays = endValue === 'ongoing' ? 'ongoing' : parseFloat(endValue);
        
        if (!isNaN(startDays) && (endValue === 'ongoing' || !isNaN(endDays))) {
          medications.push({
            name: name,
            order: parseInt(match[2]),
            start: startDays,
            end: endDays,
            type: match[5].trim()
          });
        }
      }
    });
    
    return medications;
  };
  
  const extractLabs = (labsText) => {
    if (!labsText) return [];
    
    const labs = [];
    const labRegex = /Lab Order ([^(]+)\(Line ([^)]+)\): ([^-]+) - ([^-]+) - ([^:]+): ([^(]+)(?:\(flag: ([^,]+))?/g;
    let match;
    
    while ((match = labRegex.exec(labsText)) !== null) {
      const result = match[6].trim();
      const numericResult = parseFloat(result);
      
      labs.push({
        orderId: match[1].trim(),
        line: match[2].trim(),
        testCategory: match[3].trim(),
        testName: match[4].trim(),
        component: match[5].trim(),
        result: result,
        numericValue: !isNaN(numericResult) ? numericResult : null,
        flag: match[7] ? match[7].trim() : null
      });
    }
    
    return labs;
  };

  const createTimelinePlot = (patient) => {
    const visitTypes = patient.visits.map(v => v.encounterType);
    const uniqueTypes = [...new Set(visitTypes)];
    const colorMap = {
      "Office Visit": "#2ecc71",
      "Consult": "#3498db",
      "Well Visit (Conv.)": "#9b59b6",
      "Telemedicine": "#e74c3c",
      "Telephone": "#f1c40f"
    };

    // Convert age in days to years for x-axis
    const traces = uniqueTypes.map(type => {
      const typeVisits = patient.visits.filter(v => v.encounterType === type);
      return {
        x: typeVisits.map(v => (v.ageInDays / 365).toFixed(2)),
        y: Array(typeVisits.length).fill(0),
        mode: 'markers',
        name: type,
        marker: {
          size: 12,
          color: colorMap[type] || '#95a5a6',
          line: { width: 2, color: 'white' }
        },
        hovertemplate: `
          <b>%{customdata.encounterType}</b><br>
          Date: %{customdata.date}<br>
          Age: %{customdata.age}<br>
          Weight: %{customdata.weight}<br>
          Diagnoses: %{customdata.diagnoses}<br>
          <extra></extra>
        `,
        customdata: typeVisits.map(v => ({
          encounterType: v.encounterType,
          date: v.date.toLocaleDateString(),
          age: formatAge(v.ageInDays),
          weight: v.weight ? `${(v.weight/16).toFixed(1)} lbs` : 'N/A',
          diagnoses: v.diagnoses.join(', ') || 'None'
        }))
      };
    });

    // Calculate the age range for better axis formatting
    const allAges = patient.visits.map(v => v.ageInDays / 365);
    const minAge = Math.floor(Math.min(...allAges));
    const maxAge = Math.ceil(Math.max(...allAges));
    const tickValues = Array.from(
      { length: maxAge - minAge + 1 }, 
      (_, i) => minAge + i
    );

    return {
      data: traces,
      layout: {
        title: {
          text: 'Patient Journey Timeline',
          font: { size: 24, color: '#2d3748' }
        },
        xaxis: {
          title: {
            text: 'Age (Years)',
            font: { size: 16, color: '#4a5568' }
          },
          tickvals: tickValues,
          ticktext: tickValues.map(year => `${year}y`),
          gridcolor: '#e2e8f0',
          zeroline: false
        },
        yaxis: {
          visible: false,
          showgrid: false
        },
        showlegend: true,
        legend: {
          title: {
            text: 'Visit Types',
            font: { size: 14, color: '#4a5568' }
          },
          bgcolor: 'rgba(255, 255, 255, 0.9)',
          bordercolor: '#e2e8f0',
          borderwidth: 1
        },
        hovermode: 'closest',
        hoverlabel: {
          bgcolor: 'white',
          font: { family: 'Arial, sans-serif', size: 14 },
          bordercolor: '#718096'
        },
        margin: { l: 50, r: 50, t: 80, b: 50 },
        plot_bgcolor: 'white',
        paper_bgcolor: 'white',
        font: { 
          family: 'Arial, sans-serif', 
          size: 12,
          color: '#4a5568'
        },
        shapes: [{
          type: 'rect',
          xref: 'paper',
          yref: 'paper',
          x0: 0,
          y0: 0,
          x1: 1,
          y1: 1,
          line: {
            color: '#e2e8f0',
            width: 1
          }
        }]
      }
    };
  };

  // Toggle expanded section visibility
  const toggleSection = (section) => {
    setExpandedSections({
      ...expandedSections,
      [section]: !expandedSections[section]
    });
  };

  // Map of diagnosis codes to readable descriptions
  const diagnosisMap = {
    'L20.9': 'Atopic Dermatitis',
    'K59.00': 'Constipation',
    'K59.01': 'Constipation',
    'J45.30': 'Asthma',
    'J45.40': 'Asthma',
    'J45.41': 'Asthma Exacerbation',
    'R50.81': 'Fever',
    'L29.3': 'Pruritus',
    'J06.9': 'Upper Respiratory Infection',
    'R30.0': 'Dysuria',
    'N30.01': 'Urinary Tract Infection',
    'H66.91': 'Otitis Media',
    'F41.9': 'Anxiety',
    'F41.1': 'Generalized Anxiety',
    'N76.0': 'Vaginitis',
    'R94.120': 'Abnormal Ultrasound',
    'B37.2': 'Candidiasis',
    'L22': 'Diaper Dermatitis'
  };

  const diagnosisCategories = {
      'Respiratory': ['J06.9', 'J45.30', 'J45.40', 'J45.41', 'R05.9', 'R06.2', 'R06.83'],
      'Skin': ['L20.9', 'L29.3', 'L30.9', 'L08.9', 'L01.00', 'L02.91', 'L03.116', 'B37.2', 'L22'],
      'GI/Urinary': ['K59.00', 'K59.01', 'R30.0', 'N30.01', 'N76.0', 'K52.9'],
      'ENT': ['H66.91', 'J02.0', 'J34.89', 'H92.01'],
      'Mental Health': ['F41.9', 'F41.1', 'F80.0', 'R46.89'],
      'Other': []
    };
    
const diagnosisCategoryColors = {
  'Respiratory': 'bg-blue-500',
  'Skin': 'bg-pink-500',
  'GI/Urinary': 'bg-amber-500',
  'ENT': 'bg-green-500',
  'Mental Health': 'bg-purple-500',
  'Other': 'bg-gray-500'
};

const getDiagnosisCategory = (code) => {
  if (!code) return 'Other';
  const entry = Object.entries(diagnosisCategories).find(([, codes]) => codes.includes(code));
  return entry ? entry[0] : 'Other';
  };

  // Prepare weight/height data for growth charts
  const prepareGrowthData = () => {
    if (!selectedPatient || !filteredVisits.length) return [];
    
    const patientData = filteredVisits
      .filter(visit => visit.weight && visit.ageInDays)
      .map(visit => ({
        ageInDays: Math.round(visit.ageInDays),
        weight: visit.weight / 16, // Convert oz to lbs
        height: visit.height,
        date: visit.date
      }))
      .sort((a, b) => a.ageInDays - b.ageInDays);

    if (!patientData.length) return [];

    // Generate percentile curves for each age point
    const agePoints = Array.from(
      { length: Math.ceil(Math.max(...patientData.map(d => d.ageInDays)) / 30) },
      (_, i) => i * 30
    );

    const percentileCurves = agePoints.flatMap(age => 
      generatePercentileCurves(age, selectedPatient.sex === 'Male' ? 1 : 2)
        .map(curve => ({
          ageInDays: age,
          [`weight_p${curve.percentile}`]: curve.value
        }))
    );

    // Combine patient data with percentile curves
    const combinedData = agePoints.map(age => {
      const patientPoint = patientData.find(d => 
        Math.abs(d.ageInDays - age) < 15
      );
      const percentiles = percentileCurves
        .filter(p => p.ageInDays === age)
        .reduce((acc, curr) => ({ ...acc, ...curr }), {});

      return {
        ageInDays: age,
        weight: patientPoint?.weight,
        height: patientPoint?.height,
        ...percentiles
      };
    });

    return combinedData;
  };

  const diagnosisInsights = useMemo(() => {
    if (!selectedPatient || !filteredVisits.length) {
      return {
        topDiagnoses: [],
        categoryCounts: [],
        timeline: [],
        timelineRange: { start: 0, end: 0, span: 1 },
        summary: {
          totalDiagnoses: 0,
          uniqueDiagnoses: 0,
          avgPerVisit: 0,
          mostCommonCategory: 'N/A'
        }
      };
    }

    const diagnosisCounts = new Map();
    const timelineEntries = []; // Store each diagnosis occurrence separately
    const categoryCountsMap = Object.keys(diagnosisCategories).reduce((acc, category) => {
      acc[category] = 0;
      return acc;
    }, { Other: 0 });

    const sortedVisits = [...filteredVisits].sort((a, b) => (a.ageInDays || 0) - (b.ageInDays || 0));
    const minAge = sortedVisits[0]?.ageInDays || 0;
    const maxAge = sortedVisits[sortedVisits.length - 1]?.ageInDays || 0;
    const span = Math.max(1, maxAge - minAge);

    sortedVisits.forEach((visit, visitIdx) => {
      const visitAge = visit.ageInDays || 0;
      visit.diagnoses.forEach((code, diagIdx) => {
        diagnosisCounts.set(code, (diagnosisCounts.get(code) || 0) + 1);

        // Store each diagnosis occurrence as a separate entry
        timelineEntries.push({
            code,
            description: diagnosisMap[code] || lookupICDCode(code)?.description || 'Description not available',
            firstAge: visitAge,
          lastAge: visitAge + 1, // Single point event, give it a small duration for visibility
          occurrences: 1,
          diagnosisId: `${visit.visitId || visitIdx}-${code}-${diagIdx}`
          });

        let matchedCategory = false;
        Object.entries(diagnosisCategories).forEach(([category, codes]) => {
            if (codes.includes(code)) {
            categoryCountsMap[category] += 1;
            matchedCategory = true;
          }
        });
        if (!matchedCategory) {
          categoryCountsMap.Other += 1;
            }
          });
        });
        
    const topDiagnoses = Array.from(diagnosisCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([code, count]) => ({
        code,
        description: diagnosisMap[code] || lookupICDCode(code)?.description || 'Description not available',
            count
      }));

    const categoryCounts = Object.entries(categoryCountsMap)
      .filter(([, count]) => count > 0)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    // Sort timeline by diagnosis code then by age
    const timeline = timelineEntries
      .map(entry => ({
        ...entry,
        duration: Math.max(1, entry.lastAge - entry.firstAge)
      }))
      .sort((a, b) => {
        if (a.code !== b.code) return a.code.localeCompare(b.code);
        return a.firstAge - b.firstAge;
      });

    const totalDiagnoses = Array.from(diagnosisCounts.values()).reduce((sum, value) => sum + value, 0);
    const uniqueDiagnoses = diagnosisCounts.size;
    const avgPerVisit = filteredVisits.length
      ? Number((totalDiagnoses / filteredVisits.length).toFixed(1))
      : 0;

    return {
      topDiagnoses,
      categoryCounts,
      timeline,
      timelineRange: { start: minAge, end: maxAge, span },
      summary: {
        totalDiagnoses,
        uniqueDiagnoses,
        avgPerVisit,
        mostCommonCategory: categoryCounts[0]?.category || 'N/A'
      }
    };
  }, [selectedPatient, filteredVisits, icdCodesLoaded]);

  const medicationInsights = useMemo(() => {
    if (!selectedPatient || !filteredVisits.length) {
      return {
        topMedications: [],
        categoryCounts: [],
        timeline: [],
        timelineRange: { start: 0, end: 0, span: 1 },
        summary: {
          totalOrders: 0,
          uniqueMedications: 0,
          activeMedications: 0,
          dominantCategory: 'N/A'
        }
      };
    }

    const medicationCounts = new Map();
    const categoryCounts = Object.keys(medicationColorMap).reduce((acc, category) => {
      acc[category] = 0;
      return acc;
    }, { Other: 0 });
    const timelineEntries = []; // Store each prescription separately

    const sortedVisits = [...filteredVisits].sort((a, b) => (a.ageInDays || 0) - (b.ageInDays || 0));
    const minAge = sortedVisits[0]?.ageInDays || 0;
    const maxAge = sortedVisits[sortedVisits.length - 1]?.ageInDays || 0;
    const span = Math.max(1, maxAge - minAge);

    sortedVisits.forEach((visit, visitIdx) => {
      const visitAge = visit.ageInDays || 0;
      visit.medications.forEach((med, medIdx) => {
        const type = getMedicationType(med.name);
        medicationCounts.set(med.name, (medicationCounts.get(med.name) || 0) + 1);
        categoryCounts[type] = (categoryCounts[type] || 0) + 1;

        const startAge = parseInt(med.start) || visitAge;
        const endAge = med.end === 'ongoing'
          ? maxAge
          : (parseInt(med.end) || startAge + 1);

        // Store each prescription as a separate entry
        timelineEntries.push({
            name: med.name,
            type,
            firstStart: startAge,
          lastEnd: Math.max(endAge, startAge + 1),
          duration: Math.max(endAge - startAge, 1),
          occurrences: 1,
          prescriptionId: `${visit.visitId || visitIdx}-${med.name}-${medIdx}`
        });
      });
    });
    
    const topMedications = Array.from(medicationCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({
        name,
        type: getMedicationType(name),
        count
      }));

    const categoryCountsArray = Object.entries(categoryCounts)
      .filter(([, count]) => count > 0)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    // Sort timeline by medication name then by start date
    const timeline = timelineEntries.sort((a, b) => {
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.firstStart - b.firstStart;
      });

    const totalOrders = Array.from(medicationCounts.values()).reduce((sum, value) => sum + value, 0);
    const uniqueMedications = medicationCounts.size;
    const activeMedications = timeline.filter(entry => entry.lastEnd >= maxAge - 1).length;

    return {
      topMedications,
      categoryCounts: categoryCountsArray,
      timeline,
      timelineRange: { start: minAge, end: maxAge, span },
      summary: {
        totalOrders,
        uniqueMedications,
        activeMedications,
        dominantCategory: categoryCountsArray[0]?.category || 'N/A'
      }
    };
  }, [selectedPatient, filteredVisits]);

  const medicationTimelineSpan = patientMaxAge || 1;

  const getMedicationBarStyle = useCallback((med) => {
    const span = medicationTimelineSpan || 1;
    const startPercent = Math.max(0, Math.min(100, (med.start / span) * 100));
    const rawWidth = ((Math.max(med.end || med.start, med.start + 1) - med.start) / span) * 100;
    const widthPercent = Math.max(0.8, Math.min(100 - startPercent, rawWidth));
    return {
      left: `${startPercent}%`,
      width: `${widthPercent}%`
    };
  }, [medicationTimelineSpan]);

  const sortedDiagnosisTimeline = useMemo(() => {
    if (!diagnosisInsights.timeline) return [];
    const entries = [...diagnosisInsights.timeline];
    if (diagnosisTimelineSort === 'first') {
      entries.sort((a, b) => a.firstAge - b.firstAge);
    } else {
      entries.sort((a, b) => b.lastAge - a.lastAge);
    }
    return entries;
  }, [diagnosisInsights.timeline, diagnosisTimelineSort]);

  const sortedMedicationTimeline = useMemo(() => {
    if (!medicationInsights.timeline) return [];
    const entries = [...medicationInsights.timeline];
    if (medicationTimelineSort === 'start') {
      entries.sort((a, b) => a.firstStart - b.firstStart);
    } else {
      entries.sort((a, b) => b.lastEnd - a.lastEnd);
    }
    return entries;
  }, [medicationInsights.timeline, medicationTimelineSort]);

  const diagnosisTimelineItems = useMemo(() => {
    if (!diagnosisInsights.timeline?.length) return [];
    return diagnosisInsights.timeline.map(entry => {
      const start = Number.isFinite(entry.firstAge) ? entry.firstAge : 0;
      const rawEnd = Number.isFinite(entry.lastAge) ? entry.lastAge : start;
      const end = rawEnd <= start ? start + 1 : rawEnd;
      return {
        code: entry.code,
        name: entry.description || entry.code,
        category: getDiagnosisCategory(entry.code),
        start,
        end,
        occurrences: entry.occurrences || 1,
        duration: end - start
      };
    });
  }, [diagnosisInsights.timeline]);

  const getDiagnosisBarStyle = useCallback((entry) => {
    const range = diagnosisInsights.timelineRange;
    const span = range.span || 1;
    const clampStart = Math.min(Math.max(entry.start, range.start), range.end);
    const clampEnd = Math.max(clampStart + 1, Math.min(entry.end, range.end));
    const leftPercent = span ? ((clampStart - range.start) / span) * 100 : 0;
    const widthPercent = span ? ((clampEnd - clampStart) / span) * 100 : 0;
    const safeLeft = Math.min(Math.max(leftPercent, 0), 100);
    const safeWidth = Math.min(Math.max(widthPercent, 0.8), 100 - safeLeft);
    return {
      left: `${safeLeft}%`,
      width: `${safeWidth}%`
    };
  }, [diagnosisInsights.timelineRange]);

  const renderDiagnosisTimelineBar = (item, idx) => {
    const colorClass = diagnosisCategoryColors[item.category] || 'bg-gray-400';
    const durationDays = Math.max(1, Math.round(item.end - item.start));
    return (
      <div key={`${item.code}-${idx}`} className="relative h-8 group">
        <div className="absolute top-0 h-full w-full">
          <div
            className={`absolute top-0 h-6 mt-1 ${colorClass} opacity-80 rounded-md hover:opacity-100 transition-opacity cursor-pointer`}
            style={getDiagnosisBarStyle(item)}
          >
            <div className="opacity-0 group-hover:opacity-100 absolute bottom-full left-0 mb-2 bg-white p-2 rounded-lg shadow-lg border border-gray-200 text-xs whitespace-nowrap z-10">
              <p className="font-semibold text-gray-900">{item.name}</p>
              <p className="text-gray-600 mb-1">Code: {item.code}</p>
              <p className="text-gray-600">Start: {formatAge(item.start)}</p>
              <p className="text-gray-600">End: {formatAge(item.end)}</p>
              <p className="text-gray-500">
                Duration: {durationDays} days · {item.occurrences} occur.
              </p>
            </div>
          </div>
        </div>
        <div className="pl-2 flex items-center h-full relative z-10 text-sm font-medium text-gray-800">
          <span className="truncate">{item.name}</span>
          <span className="text-xs text-gray-500 ml-2">({item.code})</span>
        </div>
      </div>
    );
  };

  const diagnosisTimelineRange = diagnosisInsights.timelineRange;
  const diagnosisTimelineAxisLabels = useMemo(() => {
    const range = diagnosisTimelineRange;
    const span = range.span || 1;
    return [
      range.start,
      range.start + span / 3,
      range.start + (span * 2) / 3,
      range.end
    ];
  }, [diagnosisTimelineRange]);

  // Prepare BMI data
  const prepareBMIData = () => {
    if (!selectedPatient || !filteredVisits.length) return [];
    
    return filteredVisits
      .filter(visit => visit.weight && visit.height && visit.ageInDays)
      .map(visit => {
        // weight is in oz, height in inches
        const weightLbs = visit.weight / 16;
        const heightIn = visit.height;
        const bmi = (weightLbs * 703) / (heightIn * heightIn);
        
        return {
          ageInDays: Math.round(visit.ageInDays),
          bmi: parseFloat(bmi.toFixed(1))
        };
      })
      .sort((a, b) => a.ageInDays - b.ageInDays);
  };
  const bmiTrendData = prepareBMIData();

  const prepareZScoreData = (measurement = 'weight') => {
    if (!selectedPatient || !filteredVisits.length) return [];

    const measurementKey = measurement === 'weight' ? 'weight' : 'height';

    const sexCode = selectedPatient.sex === 'Male' ? 1 : 2;

    return filteredVisits
      .filter(visit => visit.ageInDays && visit[measurementKey])
      .map(visit => {
        const value = measurement === 'weight'
          ? visit.weight / 16
          : visit.height;
        const zScore = calculateZScore(
          value,
          Math.round(visit.ageInDays),
          measurement,
          sexCode
        );
        return {
          ageInDays: Math.round(visit.ageInDays),
          zScore: zScore != null ? parseFloat(zScore.toFixed(2)) : null
        };
      })
      .filter(point => point.zScore != null)
      .sort((a, b) => a.ageInDays - b.ageInDays);
  };

  // Diagnoses heat map data preparation
  // Calculate measurement value for a given percentile using LMS method
  const calculatePercentileValue = (L, M, S, zScore) => {
    if (L === 0) {
      return M * Math.exp(S * zScore);
    }
    return M * Math.pow(1 + L * S * zScore, 1 / L);
  };

  const getMockLMSValues = (ageInDays, measurement = 'weight', sex = 1) => {
    const ageYears = ageInDays / 365;
    if (measurement === 'height') {
      return {
        L: 0.2,
        M: 18 + ageYears * 2.5 + (sex === 1 ? 0.5 : 0),
        S: 0.09
      };
    }
    return {
      L: -0.1600954,
      M: 9.476500305 * (1 + ageYears),
      S: 0.11218624
    };
  };

  const calculateZScore = (value, ageInDays, measurement = 'weight', sex = 1) => {
    if (value == null || !isFinite(value)) return null;
    const { L, M, S } = getMockLMSValues(ageInDays, measurement, sex);
    if (L === 0) {
      return Math.log(value / M) / S;
    }
    return (Math.pow(value / M, L) - 1) / (L * S);
  };

  // Generate percentile curves data
  const generatePercentileCurves = (ageInDays, sex) => {
    const { L, M, S } = getMockLMSValues(ageInDays, 'weight', sex);

    // Z-scores for common percentiles (3rd, 10th, 25th, 50th, 75th, 90th, 97th)
    const percentileZScores = [-1.881, -1.282, -0.674, 0, 0.674, 1.282, 1.881];
    const percentileLabels = ['3rd', '10th', '25th', '50th', '75th', '90th', '97th'];

    return percentileZScores.map((zScore, index) => ({
      percentile: percentileLabels[index],
      value: calculatePercentileValue(L, M, S, zScore)
    }));
  };

  const prepareProblemResolutionData = (visits) => {
    const problems = new Map();
    const resolutionData = [];
    
    // Sort visits by age to ensure proper chronological order
    const sortedVisits = [...visits].sort((a, b) => a.ageInDays - b.ageInDays);
    const latestVisitAge = Math.max(...visits.map(v => v.ageInDays));
    
    sortedVisits.forEach(visit => {
      visit.diagnoses.forEach(code => {
        if (!problems.has(code)) {
          problems.set(code, {
            firstSeen: visit.ageInDays,
            lastSeen: visit.ageInDays,
            occurrences: [visit.ageInDays],
            name: lookupICDCode(code)?.description || diagnosisMap[code] || `${code} (Unmapped)`
          });
        } else {
          const problem = problems.get(code);
          problem.lastSeen = visit.ageInDays;
          problem.occurrences.push(visit.ageInDays);
        }
      });
    });
    
    problems.forEach((data, code) => {
      // Calculate duration from first to last occurrence
      const duration = (data.lastSeen - data.firstSeen) / 365; // Convert to years
      
      // Consider a problem resolved if:
      // 1. It hasn't been seen in the last year (365 days)
      // 2. And it's not from the most recent visit
      const daysSinceLastSeen = latestVisitAge - data.lastSeen;
      const isResolved = daysSinceLastSeen > 365 && data.lastSeen !== latestVisitAge;
      
      resolutionData.push({
        problem: data.name,
        code: code,
        firstSeen: data.firstSeen / 365, // Convert to years
        lastSeen: data.lastSeen / 365, // Convert to years
        duration: duration > 0 ? duration : 0, // Ensure non-negative duration
        resolved: isResolved,
        occurrences: data.occurrences.length,
        occurrenceDates: data.occurrences // Array of ageInDays when diagnosed
      });
    });
    
    return resolutionData.sort((a, b) => {
      // Sort by resolution status first (active first)
      if (a.resolved !== b.resolved) {
        return a.resolved ? 1 : -1;
      }
      // Then by last seen date (most recent first)
      return b.lastSeen - a.lastSeen;
    });
  };

  const prepareMedicationsForGantt = (visits) => {
    if (!visits || visits.length === 0) return [];
    
    // Collect each prescription as a separate entry (no merging)
    const allPrescriptions = [];
    
    visits.forEach(visit => {
      const visitAge = visit.ageInDays || 0;
      visit.medications.forEach((med, idx) => {
        const rawStart = Number.isFinite(med.start) ? med.start : visitAge;
        const startAge = Number.isFinite(rawStart) ? rawStart : visitAge;
        const endAge = med.end === 'ongoing' 
          ? Math.max(...visits.map(v => v.ageInDays || 0))
          : (Number.isFinite(med.end) ? med.end : startAge + 1);
        const safeEnd = Math.max(endAge, startAge + 1);
          
        allPrescriptions.push({
          name: med.name,
          start: Math.max(0, startAge),
          end: safeEnd,
          type: med.type,
          duration: safeEnd - Math.max(0, startAge),
          prescriptionId: `${visit.visitId || visitAge}-${med.name}-${idx}`
        });
      });
    });
    
    // Sort by medication name, then by start date
    return allPrescriptions.sort((a, b) => {
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.start - b.start;
    });
  };

  const Modal = ({ isOpen, onClose, title, children }) => {
    return (
      <Transition.Root show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={onClose}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
          </Transition.Child>

          <div className="fixed inset-0 z-10 overflow-y-auto">
            <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                enterTo="opacity-100 translate-y-0 sm:scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              >
                <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-2xl sm:p-6">
                  <div className="absolute right-0 top-0 pr-4 pt-4">
                    <button
                      type="button"
                      className="rounded-md bg-white text-gray-400 hover:text-gray-500"
                      onClick={onClose}
                    >
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>
                  <div>
                    <Dialog.Title as="h3" className="text-xl font-semibold leading-6 text-gray-900 mb-4">
                      {title}
                    </Dialog.Title>
                    <div className="mt-2">{children}</div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition.Root>
    );
  };

  // Add useEffect for loading ICD codes
  useEffect(() => {
    const loadCodes = async () => {
      const success = await loadICDCodes();
      setIcdCodesLoaded(success);
    };
    loadCodes();
  }, []);

  // Load growth percentile data
  useEffect(() => {
    const loadGrowthPercentiles = async () => {
      try {
        const response = await fetch('/growth_percentiles.json');
        if (response.ok) {
          const data = await response.json();
          setGrowthPercentiles(data);
        }
      } catch (err) {
        console.log('Could not load growth percentiles:', err.message);
      }
    };
    loadGrowthPercentiles();
  }, []);

  // Handle mouse enter for ICD tooltip - stores position for portal rendering
  const handleICDTooltipEnter = (e, code, uniqueId, description) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const icdInfo = code ? lookupICDCode(code) : null;
    setHoveredCode({ 
      code, 
      uniqueId, 
      description: description || icdInfo?.description || diagnosisMap[code],
      icdInfo,
      rect: {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
        width: rect.width,
        height: rect.height
      }
    });
  };

  // Global ICD Tooltip Portal - renders outside scroll containers
  const ICDTooltipPortal = () => {
    if (!hoveredCode || !hoveredCode.rect) return null;
    
    const { code, description, icdInfo, rect } = hoveredCode;
    
    // Calculate position - prefer below, but go above if near bottom of viewport
    const viewportHeight = window.innerHeight;
    const tooltipHeight = 100; // Approximate height
    const showAbove = rect.bottom + tooltipHeight > viewportHeight - 20;
    
    const style = {
      position: 'fixed',
      left: Math.min(rect.left, window.innerWidth - 280), // Keep within viewport
      top: showAbove ? rect.top - tooltipHeight - 8 : rect.bottom + 8,
      zIndex: 99999
    };
    
    return createPortal(
      <div 
        style={style}
        className="w-64 p-2 bg-white rounded-lg shadow-lg border border-gray-200 text-sm pointer-events-none"
      >
        <p className="font-semibold mb-1">{code}</p>
        {description ? (
          <>
            <p className="text-gray-700">{description}</p>
            {icdInfo?.validFrom && (
              <p className="text-xs text-gray-500 mt-1">
                Valid: {new Date(icdInfo.validFrom).toLocaleDateString()} - 
                {icdInfo.validTo ? new Date(icdInfo.validTo).toLocaleDateString() : 'Present'}
              </p>
            )}
          </>
        ) : (
          <p className="text-red-500 italic">Code not found in ICD database</p>
        )}
      </div>,
      document.body
    );
  };

  // Add a function to render diagnosis code with tooltip
  // uniqueId is optional - if provided, only this specific element shows tooltip on hover
  const renderDiagnosisCode = (code, uniqueId = null) => {
    if (!code) return null;
    
    const icdInfo = lookupICDCode(code);
    const description = icdInfo?.description || diagnosisMap[code];
    const isUnmapped = !description;
    const elementId = uniqueId || code;
    
    return (
      <span
        key={elementId}
        className="cursor-help"
        onMouseEnter={(e) => handleICDTooltipEnter(e, code, elementId, description)}
        onMouseLeave={() => setHoveredCode(null)}
      >
        <span className={`inline-block px-2 py-1 text-xs rounded border
          ${isUnmapped ? 'bg-gray-50 text-gray-500 border-gray-300 border-dashed' : 
            code.startsWith('J') ? 'bg-blue-100 text-blue-800 border-blue-200' :
            code.startsWith('L') ? 'bg-green-100 text-green-800 border-green-200' :
            (code.startsWith('K') || code.startsWith('N')) ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
            code.startsWith('F') ? 'bg-purple-100 text-purple-800 border-purple-200' :
            code.startsWith('H') ? 'bg-pink-100 text-pink-800 border-pink-200' :
            'bg-gray-100 text-gray-800 border-gray-200'}
        `}>
          {isUnmapped ? `${code} (Unmapped)` : description}
        </span>
      </span>
    );
  };

  // Render a problem/diagnosis with ICD code tooltip
  const renderProblemWithTooltip = (problem, uniqueId) => {
    if (!problem) return null;
    
    const code = problem.code;
    const icdInfo = code ? lookupICDCode(code) : null;
    const description = problem.problem || problem.name || (icdInfo?.description) || diagnosisMap[code] || 'Unknown';
    
    return (
      <span
        key={uniqueId}
        className="cursor-help"
        onMouseEnter={(e) => handleICDTooltipEnter(e, code, uniqueId, description)}
        onMouseLeave={() => setHoveredCode(null)}
      >
        <span className="text-sm hover:underline">{description}</span>
      </span>
    );
  };

  // Custom Tooltip for Growth Charts
  const CustomGrowthTooltip = ({ active, payload, label, type }) => {
    if (active && payload && payload.length) {
      const ageInDays = label;
      
      let patientMetric, unit, labelText;
      if (type === 'weight') {
        patientMetric = 'weight';
        unit = 'lbs';
        labelText = 'Patient Weight';
      } else if (type === 'height') {
        patientMetric = 'height';
        unit = '"';
        labelText = 'Patient Height';
      } else if (type === 'bmi') {
        patientMetric = 'bmi';
        unit = '';
        labelText = 'Patient BMI';
      }

      const patientValue = payload.find(p => p.dataKey === patientMetric);
      const medianValue = payload.find(p => p.dataKey === `${patientMetric}_p50th`);
      
      return (
        <div className="bg-white p-3 border border-gray-200 shadow-lg rounded-lg text-sm z-50">
          <p className="font-semibold text-gray-700 mb-2 border-b pb-1">
            Age: {formatAge(ageInDays)}
          </p>
          
          <div className="space-y-1">
            {patientValue && patientValue.value != null ? (
              <div className="flex items-center justify-between gap-4">
                <span className="font-bold text-indigo-600">{labelText}:</span>
                <span className="font-bold text-indigo-600">
                  {Number(patientValue.value).toFixed(1)} {unit}
                </span>
              </div>
            ) : (
               <p className="text-gray-400 italic text-xs mb-1">No measurement recorded</p>
            )}
            
            {medianValue && (
              <div className="flex items-center justify-between gap-4 text-gray-500 text-xs">
                <span>Median (50th):</span>
                <span>{Number(medianValue.value).toFixed(1)} {unit}</span>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  const formatVisitData = (visit) => {
    if (!visit) {
      return 'No visit data available';
    }

    // Get active problems at this time
    const activeProblems = prepareProblemResolutionData(
      selectedPatient.visits.filter(v => v.ageInDays <= visit.ageInDays)
    ).filter(problem => !problem.resolved);

    // Get problems resolved at this visit
    const resolvedProblems = prepareProblemResolutionData(
      selectedPatient.visits.filter(v => v.ageInDays <= visit.ageInDays)
    ).filter(problem => 
      problem.resolved && 
      problem.lastSeen === visit.ageInDays / 365
    );

    // Get active medications at this time
    const activeMedications = prepareMedicationsForGantt(filteredVisits)
      .filter(med => {
        const mostRecentVisitAge = Math.max(...selectedPatient.visits.map(v => v.ageInDays));
        return med.start <= visit.ageInDays && 
          (med.end === 'ongoing' || (med.end >= visit.ageInDays && med.end <= mostRecentVisitAge));
      });

    // Format height with last recorded if not available
    let heightInfo = visit.height ? 
      `${visit.height}" tall` : 
      (() => {
        const previousVisits = selectedPatient.visits.filter(v => v.ageInDays < visit.ageInDays);
        const lastRecordedHeight = previousVisits.length > 0 ? 
          [...previousVisits].sort((a, b) => b.ageInDays - a.ageInDays).find(v => v.height)?.height : null;
        return `Height not recorded${lastRecordedHeight ? `. Last recorded: ${lastRecordedHeight}"` : ''}`;
      })();

    return `
Visit Information:
----------------
Date: ${formatAge(visit.ageInDays)}
Visit Type: ${visit.encounterType || 'Not specified'}
Height: ${heightInfo}
Weight: ${visit.weight ? `${(visit.weight/16).toFixed(1)} lbs` : 'Not recorded'}

Diagnoses at Visit:
-----------------
${visit.diagnoses.map(code => {
  const description = lookupICDCode(code)?.description || diagnosisMap[code] || '(Unmapped)';
  return `- ${code}: ${description}`;
}).join('\n') || 'None recorded'}

Active Problems:
-------------
${activeProblems.map(problem => 
  `- ${problem.problem} (Active since: ${formatAge(problem.firstSeen * 365)})`
).join('\n') || 'No active problems'}

Problems Resolved at this Visit:
----------------------------
${resolvedProblems.map(problem => 
  `- ${problem.problem} (Duration: ${Math.round(problem.duration * 365)} days)`
).join('\n') || 'No problems resolved at this visit'}

Active Medications:
----------------
${activeMedications.map(med => 
  `- ${med.name} (Started: ${formatAge(med.start)}${med.end === 'ongoing' ? ' - Ongoing' : ` - End: ${formatAge(med.end)}`})`
).join('\n') || 'No active medications'}

Medications Prescribed at Visit:
----------------------------
${(visit.medications || []).map(med => 
  typeof med === 'object' ? 
    `- ${med.name} (Start: ${formatAge(med.start)}${med.end === 'ongoing' ? ' - Ongoing' : ` - End: ${formatAge(med.end)}`})` :
    `- ${med}`
).join('\n') || 'No medications prescribed'}

Laboratory Results:
----------------
${(visit.labs || []).map(lab => 
  `- ${lab.testName} (${lab.component}): ${lab.result}
    Status: ${lab.flag === 'H' ? 'High' : lab.flag === 'L' ? 'Low' : 'Normal'}`
).join('\n') || 'No lab results recorded'}

Referrals:
---------
${visit.referrals_details ? 
  visit.referrals_details.split(';').map(referral => `- ${referral.trim()}`).join('\n') : 
  'No referrals recorded'}
    `.trim();
  };

  const handleSendVisitToLLM = async (visit) => {
    setSelectedVisitForLLM(visit);
    setIsLLMModalOpen(true);
    setIsGenerating(true);

    const visitData = formatVisitData(visit);
    const prompt = `Act as an expert medical assistant helping to generate a concise summary of a pediatric patient visit. 
    Please analyze this visit data and provide a clear, professional summary highlighting key findings, 
    diagnoses, treatments, and any follow-up recommendations. Focus on the most important clinical details. Write it as if this is the final report so don't add any filler words or questions.

    Use this template to write a summary for the visit of the patient:

    Patient Age:  [Use age at visit in days (years, months)]
    Visit Type: [the visit type]

    Summary:
    The patient presented for an office visit.  The following diagnoses were documented: [mention the diagnoses]. The patient's height at this visit is [patient height] and the patient's weight is [patient weight].

    The active problems of the patient at this point include [active problems].

    The current medications of the patient at this point include [active medications].

    Disclaimer: This summary is based solely on the provided data and may lack critical details due to missing information. It should be supplemented with a thorough review of the patient's complete medical record.
    
    This is the data that you will use to generate the summary:
    
    Visit Data:
    ${visitData}`;

    try {
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama3.2:3b',
          prompt: prompt,
          stream: false
        }),
      });

      const data = await response.json();
      setChatMessages([
        {
          role: 'assistant',
          content: data.response
        }
      ]);
    } catch (error) {
      console.error('Error generating summary:', error);
      setChatMessages([
        {
          role: 'assistant',
          content: 'Sorry, I encountered an error while generating the summary. Please try again.'
        }
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendToLLM = async () => {
    if (!selectedPatient) return;
    
    setIsGenerating(true);
    setChatMessages([]);
    
    try {
      // Get the most recent N visits
      const recentVisits = [...selectedPatient.visits]
        .sort((a, b) => b.ageInDays - a.ageInDays)
        .slice(0, visitSummaryCount)
        .reverse(); // Reverse to get chronological order (oldest to newest)
      
      // Process all problems once
      const problemsMap = new Map();
      recentVisits.forEach(visit => {
        visit.diagnoses.forEach(code => {
          if (!problemsMap.has(code)) {
            problemsMap.set(code, {
              firstSeen: visit.ageInDays,
              lastSeen: visit.ageInDays,
              occurrences: [visit.ageInDays],
              name: lookupICDCode(code)?.description || diagnosisMap[code] || `${code} (Unmapped)`
            });
          } else {
            const problem = problemsMap.get(code);
            problem.lastSeen = visit.ageInDays;
            problem.occurrences.push(visit.ageInDays);
          }
        });
      });

      // Process all medications once
      const medicationsMap = new Map();
      recentVisits.forEach(visit => {
        visit.medications.forEach(med => {
          const key = med.name;
          if (!medicationsMap.has(key)) {
            medicationsMap.set(key, {
              name: med.name,
              start: parseInt(med.start),
              end: med.end === 'ongoing' ? Math.max(...recentVisits.map(v => v.ageInDays)) : parseInt(med.end),
              type: med.type
            });
          }
        });
      });

      // Format the visits data for the LLM
      const visitsData = recentVisits.map(visit => {
        // Get active problems at this time
        const activeProblems = Array.from(problemsMap.values())
          .filter(problem => 
            !problem.resolved && 
            problem.firstSeen <= visit.ageInDays
          );

        // Get problems resolved at this visit
        const resolvedProblems = Array.from(problemsMap.values())
          .filter(problem => 
            problem.lastSeen === visit.ageInDays
          );

        // Get active medications at this time
        const activeMedications = Array.from(medicationsMap.values())
          .filter(med => 
            med.start <= visit.ageInDays && 
            (med.end === 'ongoing' || med.end >= visit.ageInDays)
          );

        return {
          age: formatAge(visit.ageInDays),
          encounterType: visit.encounterType,
          weight: visit.weight ? `${(visit.weight/16).toFixed(1)} lbs` : 'Not recorded',
          height: visit.height ? `${visit.height}"` : 'Not recorded',
          diagnoses: visit.diagnoses.map(code => ({
            code,
            description: lookupICDCode(code)?.description || diagnosisMap[code] || `${code} (Unmapped)`
          })),
          activeProblems: activeProblems.map(p => ({
            name: p.name,
            duration: Math.round((p.lastSeen - p.firstSeen) / 365),
            firstSeen: formatAge(p.firstSeen)
          })),
          resolvedProblems: resolvedProblems.map(p => ({
            name: p.name,
            duration: Math.round((p.lastSeen - p.firstSeen) / 365)
          })),
          activeMedications: activeMedications.map(m => ({
            name: m.name,
            start: formatAge(m.start),
            end: m.end === 'ongoing' ? 'Ongoing' : formatAge(m.end)
          })),
          labResults: visit.labs.map(lab => ({
            test: lab.testName,
            component: lab.component,
            result: lab.result,
            flag: lab.flag,
            status: lab.flag ? 
              (lab.flag.includes('H') ? 'High' : 
               lab.flag.includes('L') ? 'Low' : 
               lab.flag.includes('A') ? 'Abnormal' : 'Normal') : 
              'Normal',
            value: lab.numericValue,
            unit: lab.unit
          })),
          referrals: visit.referrals_details ? visit.referrals_details.split(';').map(r => r.trim()) : []
        };
      });

      const prompt = `Act as an expert medical assistant helping to analyze the recent visits of a pediatric patient. 
      Please analyze the following visit data and provide:
      1. A chronological summary of the visits
      2. Key trends and patterns in diagnoses, medications, and lab results
      3. Potential issues or concerns that should be addressed
      4. Key trends in growth patterns (weight and height) over all the visits
      5. Actionable insights such as potential things that can be checked by the physician

      Focus on:
      - Changes in active problems and their duration
      - Abnormal lab results and their trends (pay special attention to results marked as High, Low, or Abnormal. (Whenever talking about abnormal labs, for example, give the exact numbers for the labs for the patient and the normal ranges that are expected)
      - Growth patterns (weight and height). If any are worth noting, give the specific numbers that change abnormally.
      - Referral patterns and specialist involvement


      Patient Information:
      - Sex: ${selectedPatient.sex}
      - Ethnicity: ${selectedPatient.ethnicity}
      - Race: ${selectedPatient.race}

      Recent Visits Data:
      ${JSON.stringify(visitsData, null, 2)}

      Important rule: Whenever talking about abnormal labs, give the exact numbers for the labs for the patient and the normal ranges that are expected)

      Please provide a clear, professional analysis that highlights both immediate concerns and actionable insights. Do not give any specific dates. Pay special attention to the growth patterns (weight and height). Write it as if this is the final report so don't add any filler words or questions. Do not add any introductory word such as Here's a comprehensive analysis of the patient data, etc.`;

      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama3.2:3b',
          prompt: prompt,
          stream: false
        }),
      });

      const data = await response.json();
      setChatMessages([
        {
          role: 'assistant',
          content: data.response
        }
      ]);
    } catch (error) {
      console.error('Error generating summary:', error);
      setChatMessages([
        {
          role: 'assistant',
          content: 'Sorry, I encountered an error while generating the summary. Please try again.'
        }
      ]);
    } finally {
      setIsGenerating(false);
    }
  };


  const renderGrowthMetricChart = (label, dataKey, color, unit, tooltipType = dataKey) => {
    if (!growthSparklineData.length) {
      return (
        <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-4">
          No {label.toLowerCase()} measurements recorded yet.
        </div>
      );
    }

    // Get percentile data for this metric
    const getPercentileData = () => {
      if (!growthPercentiles || !selectedPatient) return null;
      
      // Determine sex (1 = Male, 2 = Female in CDC data)
      const sex = selectedPatient.sex?.toLowerCase() === 'f' || selectedPatient.sex?.toLowerCase() === 'female' ? 'female' : 'male';
      
      // Get the appropriate percentile dataset based on metric and patient age
      const maxAge = Math.max(...growthSparklineData.map(d => d.ageInDays));
      const minAge = Math.min(...growthSparklineData.map(d => d.ageInDays));
      
      let percentileKey;
      if (dataKey === 'weight') {
        // Use infant data for ages 0-36 months (0-1095 days), otherwise 2-20 years
        percentileKey = minAge < 730 ? 'weight_0_to_36' : 'weight_2_to_20';
      } else if (dataKey === 'height') {
        percentileKey = minAge < 730 ? 'length_0_to_36' : 'height_2_to_20';
      } else if (dataKey === 'bmi') {
        percentileKey = 'bmi_2_to_20';
      }
      
      if (!percentileKey || !growthPercentiles[percentileKey]) return null;
      
      return growthPercentiles[percentileKey][sex];
    };

    const percentileData = getPercentileData();
    
    // Merge patient data with percentile data for the chart
    const getChartData = () => {
      if (!percentileData) return growthSparklineData;
      
      // Filter percentile data to match the age range we're displaying
      const ageRange = integratedTimelineRange;
      const filteredPercentiles = percentileData.filter(
        p => p.ageInDays >= ageRange.start - 100 && p.ageInDays <= ageRange.end + 100
      );
      
      // Create a combined dataset
      const combined = [];
      
      // Add percentile curve points
      filteredPercentiles.forEach(p => {
        combined.push({
          ageInDays: p.ageInDays,
          P3: p.P3,
          P5: p.P5,
          P10: p.P10,
          P25: p.P25,
          P50: p.P50,
          P75: p.P75,
          P90: p.P90,
          P95: p.P95,
          P97: p.P97,
          isPercentile: true
        });
      });
      
      // Add patient data points
      growthSparklineData.forEach(d => {
        combined.push({
          ageInDays: d.ageInDays,
          [dataKey]: d[dataKey],
          isPatient: true
        });
      });
      
      // Sort by age
      return combined.sort((a, b) => a.ageInDays - b.ageInDays);
    };
    
    const chartData = getChartData();

    // Percentile line colors (light gray shades)
    const percentileColors = {
      P3: '#e5e7eb',
      P5: '#d1d5db',
      P10: '#9ca3af',
      P25: '#6b7280',
      P50: '#374151',
      P75: '#6b7280',
      P90: '#9ca3af',
      P95: '#d1d5db',
      P97: '#e5e7eb'
    };

    return (
      <div>
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>{label}</span>
          <div className="flex items-center gap-4">
            {percentileData && (
              <span className="text-gray-400 text-[10px]">CDC Percentiles: 3rd–97th</span>
            )}
          <span>
            Latest:{' '}
            {growthSparklineData[growthSparklineData.length - 1][dataKey] != null
              ? `${growthSparklineData[growthSparklineData.length - 1][dataKey]}${unit}`
              : '—'}
          </span>
        </div>
        </div>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              syncId="integrated-growth"
              margin={{ top: 5, right: 10, bottom: 0, left: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                type="number"
                dataKey="ageInDays"
                domain={[integratedTimelineRange.start, integratedTimelineRange.end]}
                tickFormatter={formatAgeCompact}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                width={60}
                tick={{ fontSize: 10 }}
                tickFormatter={(value) => (value == null ? '' : `${value}${unit}`)}
              />
              <Tooltip content={<CustomGrowthTooltip type={tooltipType} percentileData={percentileData} />} />
              
              {/* Percentile curves - rendered first (behind patient data) */}
              {percentileData && (
                <>
                  <Line type="monotone" dataKey="P3" stroke={percentileColors.P3} strokeWidth={1} dot={false} strokeDasharray="2 2" connectNulls />
                  <Line type="monotone" dataKey="P10" stroke={percentileColors.P10} strokeWidth={1} dot={false} strokeDasharray="2 2" connectNulls />
                  <Line type="monotone" dataKey="P25" stroke={percentileColors.P25} strokeWidth={1} dot={false} strokeDasharray="2 2" connectNulls />
                  <Line type="monotone" dataKey="P50" stroke={percentileColors.P50} strokeWidth={1.5} dot={false} connectNulls />
                  <Line type="monotone" dataKey="P75" stroke={percentileColors.P75} strokeWidth={1} dot={false} strokeDasharray="2 2" connectNulls />
                  <Line type="monotone" dataKey="P90" stroke={percentileColors.P90} strokeWidth={1} dot={false} strokeDasharray="2 2" connectNulls />
                  <Line type="monotone" dataKey="P97" stroke={percentileColors.P97} strokeWidth={1} dot={false} strokeDasharray="2 2" connectNulls />
                </>
              )}
              
              {/* Patient data - rendered last (on top) */}
              <Line
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={2}
                dot={{ r: 3, fill: color, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: color, stroke: '#fff', strokeWidth: 2 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {percentileData && (
          <div className="flex justify-center gap-4 mt-1 text-[10px] text-gray-400">
            <span>— 50th</span>
            <span className="border-b border-dashed border-gray-400">3rd/10th/25th/75th/90th/97th</span>
          </div>
        )}
      </div>
    );
  };

  const TimelineLabel = ({ text, widthClass = 'w-auto' }) => (
    <span className="relative group inline-block">
      <span className={`block ${widthClass} whitespace-nowrap text-xs font-medium text-gray-600`}>
        {text}
      </span>
    </span>
  );

  const renderIntegratedTimeline = () => {
    if (!selectedPatient) {
      return (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <p className="text-gray-500">Select a patient to view their integrated timeline.</p>
        </div>
      );
    }

    const range = integratedTimelineRange;
    const diagBands = sortedDiagnosisTimeline;
    const medBands = sortedMedicationTimeline;
    const tickCount = range.span > 0 ? Math.min(7, Math.max(3, Math.round(range.span / 365) + 1)) : 3;
    const tickSteps = Math.max(1, tickCount - 1);
    const ticks = Array.from({ length: tickCount }, (_, idx) => {
      const age = range.start + (range.span / tickSteps) * idx;
      return { age, label: formatAgeCompact(age) };
    });
    const clampAge = (age) => Math.min(Math.max(Number.isFinite(age) ? age : range.start, range.start), range.end);
    const toPercent = (age) => {
      if (!range.span) return '0%';
      const clamped = clampAge(age);
      return `${((clamped - range.start) / range.span) * 100}%`;
    };
    const bandStyle = (start, end) => {
      const safeStart = clampAge(start);
      const safeEnd = Math.max(safeStart + 5, clampAge(end ?? safeStart + 5));
      const width = range.span ? ((safeEnd - safeStart) / range.span) * 100 : 0;
      return {
        left: toPercent(safeStart),
        width: `${Math.max(width, 1)}%`
      };
    };

    const medLegend = Array.from(new Set(medBands.map(entry => entry.type)));
    const resolveAge = (value, fallback = range.end) => {
      if (Number.isFinite(value)) return value;
      return fallback;
    };
    const labFlagColorClass = (flag) => {
      if (flag === 'H') return 'bg-amber-400 border-amber-200';
      if (flag === 'L') return 'bg-rose-400 border-rose-200';
      return 'bg-emerald-400 border-emerald-100';
    };
    const labFlagLabel = (flag) => {
      if (flag === 'H') return 'High';
      if (flag === 'L') return 'Low';
      return 'Normal';
    };
    const getTimelineTooltipStyle = () => {
      if (!integratedTimelineTooltip) return {};
      const tooltipWidth = 260;
      const tooltipHeight = 120;
      const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 720;
      let left = integratedTimelineTooltip.clientX + 16;
      let top = integratedTimelineTooltip.clientY - tooltipHeight - 12;

      if (left + tooltipWidth > viewportWidth - 12) {
        left = integratedTimelineTooltip.clientX - tooltipWidth - 16;
      }
      if (left < 12) {
        left = 12;
      }

      if (top < 12) {
        top = integratedTimelineTooltip.clientY + 16;
      }
      if (top + tooltipHeight > viewportHeight - 12) {
        top = Math.max(12, viewportHeight - tooltipHeight - 12);
      }

      return { left, top };
    };

    const growthTrend = (() => {
      if (growthSparklineData.length < 2) return null;
      const first = growthSparklineData[0];
      const last = growthSparklineData[growthSparklineData.length - 1];
      const delta = (key) =>
        first[key] != null && last[key] != null ? (last[key] - first[key]).toFixed(1) : null;
      return {
        weight: delta('weight'),
        height: delta('height'),
        bmi: delta('bmi')
      };
    })();

    return (
      <div className="space-y-8">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold text-gray-800">Diagnosis & Medication Alignment</h3>
              <p className="text-sm text-gray-500">
                Each band shows when a diagnosis or medication was active. Use it to spot overlaps and
                gaps in care.
              </p>
                </div>
            <div className="text-sm text-gray-500">
              Timeline: {formatAge(range.start)} → {formatAge(range.end)}
            </div>
          </div>

          <div className="mt-6">
            <div
              className="relative h-8 mb-6 border-t border-dashed border-gray-200"
              style={TIMELINE_AXIS_STYLE}
            >
              {ticks.map((tick) => (
                <div
                  key={tick.age}
                  className="absolute -translate-x-1/2 text-[10px] text-gray-400 text-center"
                  style={{ left: toPercent(tick.age) }}
                >
                  <div className="w-px h-3 bg-gray-300 mx-auto mb-1"></div>
                  {tick.label}
            </div>
              ))}
        </div>

            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                  <span className="font-semibold text-gray-700">Diagnosis activity</span>
                  <span>Showing {diagBands.length} diagnoses</span>
                </div>
                <div className="relative">
                  <div 
                    className="space-y-2 max-h-96 overflow-y-auto pr-2"
                    onScroll={(e) => handleScroll(e, 'visualDiagnosis')}
                    ref={(el) => checkInitialScrollState(el, 'visualDiagnosis')}
                  >
                  {diagBands.length === 0 && (
                    <p className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
                      No diagnoses recorded across this patient history.
                    </p>
                  )}
                  {diagBands.map((diag, idx) => {
                    const diagColors = ['bg-indigo-500', 'bg-purple-500', 'bg-sky-500', 'bg-pink-500'];
                    const colorClass = diagColors[idx % diagColors.length];
                    const title = diag.description || diag.code;
                    const startAge = resolveAge(diag.firstAge, range.start);
                    const endAge = resolveAge(diag.lastAge, range.end);
                    return (
                      <div
                        key={`${diag.code}-${idx}`}
                          className="mb-3"
                      >
                          <div className="mb-1">
                          <TimelineLabel
                              text={title}
                          />
                        </div>
                          <div className="relative h-7 bg-indigo-50 rounded">
                          <div
                            className={`absolute top-1.5 h-3 rounded-full ${colorClass} opacity-80 cursor-pointer`}
                            style={bandStyle(startAge, endAge)}
                            onMouseEnter={(e) =>
                              setIntegratedTimelineTooltip({
                                section: 'Diagnosis',
                                title,
                                subtitle: diag.code && diag.description ? diag.code : null,
                                  meta: null,
                                startAge,
                                endAge,
                                startAgeLabel: formatAge(startAge),
                                endAgeLabel: formatAge(endAge),
                                colorClass,
                                clientX: e.clientX,
                                clientY: e.clientY
                              })
                            }
                            onMouseMove={(e) =>
                              setIntegratedTimelineTooltip((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      clientX: e.clientX,
                                      clientY: e.clientY
                                    }
                                  : prev
                              )
                            }
                            onMouseLeave={() => setIntegratedTimelineTooltip(null)}
                            title={`${title}: ${formatAge(startAge)} → ${formatAge(endAge)}`}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                  {!scrolledToBottom.visualDiagnosis && diagBands.length > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
                  )}
            </div>
          </div>

              <div className="border-t pt-4">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                  <span className="font-semibold text-gray-700">Medication coverage</span>
            </div>
                <div className="relative">
                  <div 
                    className="space-y-2 max-h-96 overflow-y-auto pr-2"
                    onScroll={(e) => handleScroll(e, 'visualMedication')}
                    ref={(el) => checkInitialScrollState(el, 'visualMedication')}
                  >
                  {medBands.length === 0 && (
                    <p className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
                      No medications have been recorded for this patient.
                    </p>
                  )}
                  {medBands.map((med, idx) => {
                    const colorClass = medicationColorMap[med.type] || 'bg-gray-400';
                    const rawStart = med.firstStart ?? med.start;
                    const rawEnd = med.lastEnd ?? med.end;
                    const startAge = resolveAge(rawStart, range.start);
                    const isOngoing = rawEnd === 'ongoing';
                    const endAge = resolveAge(isOngoing ? range.end : rawEnd, range.end);
                    return (
                      <div
                        key={`${med.name}-${idx}`}
                          className="mb-3"
                      >
                          <div className="mb-1">
                            <TimelineLabel text={med.name} />
                        </div>
                          <div className="relative h-7 bg-gray-50 rounded">
                          <div
                            className={`absolute top-1.5 h-3 rounded-full ${colorClass} opacity-80 cursor-pointer`}
                            style={bandStyle(startAge, endAge)}
                            onMouseEnter={(e) =>
                              setIntegratedTimelineTooltip({
                                section: 'Medication',
                                title: med.name,
                                subtitle: med.type,
                                  meta: null,
                                startAge,
                                endAge,
                                startAgeLabel: formatAge(startAge),
                                endAgeLabel: isOngoing ? 'Ongoing' : formatAge(endAge),
                                colorClass,
                                clientX: e.clientX,
                                clientY: e.clientY
                              })
                            }
                            onMouseMove={(e) =>
                              setIntegratedTimelineTooltip((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      clientX: e.clientX,
                                      clientY: e.clientY
                                    }
                                  : prev
                              )
                            }
                            onMouseLeave={() => setIntegratedTimelineTooltip(null)}
                            title={`${med.name}: ${formatAge(startAge)} → ${isOngoing ? 'Ongoing' : formatAge(endAge)}`}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                  {!scrolledToBottom.visualMedication && medBands.length > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
                  )}
                </div>
              </div>
              <div className="border-t pt-4 mt-4">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                  <span className="font-semibold text-gray-700">Lab activity</span>
                  <span>
                    Showing {labTimelineRows.length} labs
                  </span>
                </div>
                <div className="relative">
                  <div 
                    className="space-y-2 max-h-96 overflow-y-auto pr-2"
                    onScroll={(e) => handleScroll(e, 'visualLab')}
                    ref={(el) => checkInitialScrollState(el, 'visualLab')}
                  >
                  {labTimelineRows.length === 0 ? (
                    <p className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
                      No lab results match the current filters on this timeline.
                    </p>
                  ) : (
                    labTimelineRows.map((row, idx) => {
                      const rowKey = `${row.testName || row.component || 'Lab'}-${idx}`;
                      const labelText = `${row.testName || row.component || 'Lab'}${
                        row.unit ? ` (${row.unit})` : ''
                      }`;
                      return (
                          <div key={rowKey} className="mb-3">
                            <div className="mb-1">
                            <TimelineLabel text={labelText} />
                          </div>
                            <div className="relative h-6 bg-gray-50 rounded">
                            {row.results.map((result, resultIdx) => {
                              const leftPercent = toPercent(result.ageInDays);
                              const tooltipValue = result.result ?? result.numericValue ?? 'N/A';
                              const unitText = row.unit || result.unit;
                              const labColorClass = labFlagColorClass(result.flag);
                              return (
                                <span
                                  key={`${rowKey}-${result.ageInDays}-${resultIdx}`}
                                  className={`absolute -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full border ${labColorClass} cursor-pointer`}
                                  style={{ left: leftPercent, top: '50%' }}
                                  onMouseEnter={(e) =>
                                    setIntegratedTimelineTooltip({
                                      section: 'Lab',
                                      title: row.testName || result.testName || 'Lab Result',
                                      subtitle: row.component || result.component,
                                        meta: `${tooltipValue}${unitText ? ` ${unitText}` : ''}`,
                                      startAge: result.ageInDays,
                                      endAge: result.ageInDays,
                                      startAgeLabel: formatAge(result.ageInDays),
                                      endAgeLabel: formatAge(result.ageInDays),
                                      colorClass: labColorClass.split(' ')[0],
                                      clientX: e.clientX,
                                      clientY: e.clientY
                                    })
                                  }
                                  onMouseMove={(e) =>
                                    setIntegratedTimelineTooltip((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            clientX: e.clientX,
                                            clientY: e.clientY
                                          }
                                        : prev
                                    )
                                  }
                                  onMouseLeave={() => setIntegratedTimelineTooltip(null)}
                                  title={`${labelText}: ${tooltipValue}${
                                    unitText ? ` ${unitText}` : ''
                                  } at ${formatAge(result.ageInDays)}`}
                                ></span>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                    )}
                  </div>
                  {!scrolledToBottom.visualLab && labTimelineRows.length > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Growth Charts with CDC Percentile Curves */}
        {(() => {
          const getVisualTimelineGrowthData = (metricType) => {
            if (!growthPercentiles || !selectedPatient) return { percentileData: null, patientData: [] };
            
            const sex = selectedPatient.sex?.toLowerCase() === 'f' || selectedPatient.sex?.toLowerCase() === 'female' ? 'female' : 'male';
            const patientData = growthSparklineData;
            
            let combinedPercentileData = [];
            
            if (metricType === 'weight') {
              const infantData = growthPercentiles['weight_0_to_36']?.[sex] || [];
              const childData = growthPercentiles['weight_2_to_20']?.[sex] || [];
              combinedPercentileData = [
                ...infantData.filter(d => d.ageInDays < 730),
                ...childData
              ].sort((a, b) => a.ageInDays - b.ageInDays);
            } else if (metricType === 'height') {
              const infantData = growthPercentiles['length_0_to_36']?.[sex] || [];
              const childData = growthPercentiles['height_2_to_20']?.[sex] || [];
              combinedPercentileData = [
                ...infantData.filter(d => d.ageInDays < 730),
                ...childData
              ].sort((a, b) => a.ageInDays - b.ageInDays);
            } else if (metricType === 'bmi') {
              combinedPercentileData = growthPercentiles['bmi_2_to_20']?.[sex] || [];
            }
            
            return { percentileData: combinedPercentileData.length > 0 ? combinedPercentileData : null, patientData };
          };

          const vtWeightData = getVisualTimelineGrowthData('weight');
          const vtHeightData = getVisualTimelineGrowthData('height');
          const vtBmiData = getVisualTimelineGrowthData('bmi');

          const percentileStyles = {
            P3: { color: '#94a3b8', dash: '4 2' },
            P10: { color: '#64748b', dash: '4 2' },
            P25: { color: '#475569', dash: '3 2' },
            P50: { color: '#1e293b', dash: null },
            P75: { color: '#475569', dash: '3 2' },
            P90: { color: '#64748b', dash: '4 2' },
            P97: { color: '#94a3b8', dash: '4 2' }
          };

          return (
        <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="mb-4">
                <h3 className="text-xl font-bold text-gray-800">Growth with CDC Percentile Curves</h3>
              <p className="text-sm text-gray-500">
                  CDC growth percentile curves shown for reference ({selectedPatient?.sex === 'F' ? 'Female' : 'Male'})
              </p>
                </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Weight Chart */}
                <div>
                  <h4 className="text-md font-semibold text-gray-700 mb-2">Weight Over Time</h4>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="ageInDays" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatAgeCompact} allowDuplicatedCategory={false} />
                        <YAxis domain={['auto', 'auto']} tickFormatter={(v) => `${v}`} width={50} />
                        <Tooltip formatter={(value, name) => [`${value?.toFixed(1)} lbs`, name]} labelFormatter={(value) => `Age: ${formatAge(value)}`} />
                        {vtWeightData.percentileData && (
                          <>
                            <Line data={vtWeightData.percentileData} type="natural" dataKey="P3" stroke={percentileStyles.P3.color} strokeDasharray={percentileStyles.P3.dash} strokeWidth={1} dot={false} name="3rd" connectNulls />
                            <Line data={vtWeightData.percentileData} type="natural" dataKey="P10" stroke={percentileStyles.P10.color} strokeDasharray={percentileStyles.P10.dash} strokeWidth={1} dot={false} name="10th" connectNulls />
                            <Line data={vtWeightData.percentileData} type="natural" dataKey="P25" stroke={percentileStyles.P25.color} strokeDasharray={percentileStyles.P25.dash} strokeWidth={1} dot={false} name="25th" connectNulls />
                            <Line data={vtWeightData.percentileData} type="natural" dataKey="P50" stroke={percentileStyles.P50.color} strokeWidth={2} dot={false} name="50th" connectNulls />
                            <Line data={vtWeightData.percentileData} type="natural" dataKey="P75" stroke={percentileStyles.P75.color} strokeDasharray={percentileStyles.P75.dash} strokeWidth={1} dot={false} name="75th" connectNulls />
                            <Line data={vtWeightData.percentileData} type="natural" dataKey="P90" stroke={percentileStyles.P90.color} strokeDasharray={percentileStyles.P90.dash} strokeWidth={1} dot={false} name="90th" connectNulls />
                            <Line data={vtWeightData.percentileData} type="natural" dataKey="P97" stroke={percentileStyles.P97.color} strokeDasharray={percentileStyles.P97.dash} strokeWidth={1} dot={false} name="97th" connectNulls />
                          </>
                        )}
                        <Line data={vtWeightData.patientData} type="natural" dataKey="weight" stroke="#4F46E5" strokeWidth={3} dot={{ r: 4, fill: '#4F46E5' }} activeDot={{ r: 6 }} name="Patient" connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
            </div>
                  <div className="flex justify-center gap-3 mt-1 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-800"></span> 50th</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-400"></span> Percentiles</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-1 bg-indigo-600 rounded"></span> Patient</span>
          </div>
        </div>

                {/* Height Chart */}
                <div>
                  <h4 className="text-md font-semibold text-gray-700 mb-2">Height Over Time</h4>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="ageInDays" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatAgeCompact} allowDuplicatedCategory={false} />
                        <YAxis domain={['auto', 'auto']} tickFormatter={(v) => `${v}"`} width={50} />
                        <Tooltip formatter={(value, name) => [`${value?.toFixed(1)}"`, name]} labelFormatter={(value) => `Age: ${formatAge(value)}`} />
                        {vtHeightData.percentileData && (
                          <>
                            <Line data={vtHeightData.percentileData} type="natural" dataKey="P3" stroke={percentileStyles.P3.color} strokeDasharray={percentileStyles.P3.dash} strokeWidth={1} dot={false} name="3rd" connectNulls />
                            <Line data={vtHeightData.percentileData} type="natural" dataKey="P10" stroke={percentileStyles.P10.color} strokeDasharray={percentileStyles.P10.dash} strokeWidth={1} dot={false} name="10th" connectNulls />
                            <Line data={vtHeightData.percentileData} type="natural" dataKey="P25" stroke={percentileStyles.P25.color} strokeDasharray={percentileStyles.P25.dash} strokeWidth={1} dot={false} name="25th" connectNulls />
                            <Line data={vtHeightData.percentileData} type="natural" dataKey="P50" stroke={percentileStyles.P50.color} strokeWidth={2} dot={false} name="50th" connectNulls />
                            <Line data={vtHeightData.percentileData} type="natural" dataKey="P75" stroke={percentileStyles.P75.color} strokeDasharray={percentileStyles.P75.dash} strokeWidth={1} dot={false} name="75th" connectNulls />
                            <Line data={vtHeightData.percentileData} type="natural" dataKey="P90" stroke={percentileStyles.P90.color} strokeDasharray={percentileStyles.P90.dash} strokeWidth={1} dot={false} name="90th" connectNulls />
                            <Line data={vtHeightData.percentileData} type="natural" dataKey="P97" stroke={percentileStyles.P97.color} strokeDasharray={percentileStyles.P97.dash} strokeWidth={1} dot={false} name="97th" connectNulls />
                          </>
                        )}
                        <Line data={vtHeightData.patientData.filter(d => d.height)} type="natural" dataKey="height" stroke="#10B981" strokeWidth={3} dot={{ r: 4, fill: '#10B981' }} activeDot={{ r: 6 }} name="Patient" connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex justify-center gap-3 mt-1 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-800"></span> 50th</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-400"></span> Percentiles</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-1 bg-emerald-500 rounded"></span> Patient</span>
                  </div>
                </div>
              </div>

              {/* BMI Chart */}
              <div className="mt-6">
                <h4 className="text-md font-semibold text-gray-700 mb-2">BMI Over Time</h4>
                {bmiTrendData.length === 0 ? (
                  <p className="text-sm text-gray-500">BMI cannot be calculated (missing height or weight measurements).</p>
                ) : (
                  <>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="ageInDays" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatAgeCompact} allowDuplicatedCategory={false} />
                          <YAxis domain={['auto', 'auto']} tickFormatter={(v) => `${v}`} width={40} />
                          <Tooltip formatter={(value, name) => [`${Number(value).toFixed(1)}`, name]} labelFormatter={(value) => `Age: ${formatAge(value)}`} />
                          {vtBmiData.percentileData && (
                            <>
                              <Line data={vtBmiData.percentileData} type="natural" dataKey="P3" stroke={percentileStyles.P3.color} strokeDasharray={percentileStyles.P3.dash} strokeWidth={1} dot={false} name="3rd" connectNulls />
                              <Line data={vtBmiData.percentileData} type="natural" dataKey="P10" stroke={percentileStyles.P10.color} strokeDasharray={percentileStyles.P10.dash} strokeWidth={1} dot={false} name="10th" connectNulls />
                              <Line data={vtBmiData.percentileData} type="natural" dataKey="P25" stroke={percentileStyles.P25.color} strokeDasharray={percentileStyles.P25.dash} strokeWidth={1} dot={false} name="25th" connectNulls />
                              <Line data={vtBmiData.percentileData} type="natural" dataKey="P50" stroke={percentileStyles.P50.color} strokeWidth={2} dot={false} name="50th" connectNulls />
                              <Line data={vtBmiData.percentileData} type="natural" dataKey="P75" stroke={percentileStyles.P75.color} strokeDasharray={percentileStyles.P75.dash} strokeWidth={1} dot={false} name="75th" connectNulls />
                              <Line data={vtBmiData.percentileData} type="natural" dataKey="P90" stroke={percentileStyles.P90.color} strokeDasharray={percentileStyles.P90.dash} strokeWidth={1} dot={false} name="90th" connectNulls />
                              <Line data={vtBmiData.percentileData} type="natural" dataKey="P97" stroke={percentileStyles.P97.color} strokeDasharray={percentileStyles.P97.dash} strokeWidth={1} dot={false} name="97th" connectNulls />
                            </>
                          )}
                          <Line data={bmiTrendData} type="natural" dataKey="bmi" stroke="#F97316" strokeWidth={3} dot={{ r: 4, fill: '#F97316' }} activeDot={{ r: 6 }} name="Patient" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex justify-center gap-3 mt-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-800"></span> 50th</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-400"></span> Percentiles</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-1 bg-orange-500 rounded"></span> Patient</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })()}
        {integratedTimelineTooltip && (
          <div
            className="pointer-events-none fixed z-[9999] px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-xl text-xs text-gray-700"
            style={getTimelineTooltipStyle()}
          >
            <p className="text-[10px] uppercase tracking-wide text-gray-400 flex items-center gap-1">
              {integratedTimelineTooltip.colorClass && (
                <span className={`inline-block w-2 h-2 rounded-full ${integratedTimelineTooltip.colorClass}`}></span>
              )}
              {integratedTimelineTooltip.section}
            </p>
            <p className="text-sm font-semibold text-gray-900">{integratedTimelineTooltip.title}</p>
            {integratedTimelineTooltip.subtitle && (
              <p className="text-[11px] text-gray-500">{integratedTimelineTooltip.subtitle}</p>
            )}
            <p className="text-[11px] text-gray-600 mt-1">{integratedTimelineTooltip.meta}</p>
            <p className="text-[10px] text-gray-500">
              {integratedTimelineTooltip.startAgeLabel || formatAge(integratedTimelineTooltip.startAge)} →{' '}
              {integratedTimelineTooltip.endAgeLabel || formatAge(integratedTimelineTooltip.endAge)}
            </p>
          </div>
        )}
      </div>
    );
  };

  const renderLabsTimeline = () => {
    if (!filteredLabResults.length) {
      return (
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <p className="text-gray-500">No lab data has been recorded for this patient.</p>
                </div>
      );
    }

    if (!labTimelineRows.length) {
      return (
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <p className="text-gray-500">
            No lab results match the current filters
            {selectedLabTest !== 'all' ? ` for ${selectedLabTest}` : ''}.
            </p>
            </div>
      );
    }

    const range = labsTimelineRange;
    const tickCount = range.span > 0 ? Math.min(9, Math.max(3, Math.round(range.span / 120) + 1)) : 3;
    const tickSteps = Math.max(1, tickCount - 1);
    const ticks = Array.from({ length: tickCount }, (_, idx) => {
      const age = range.start + (range.span / tickSteps) * idx;
      return { age, label: formatAgeCompact(age) };
    });
    const clampAge = (age) => Math.min(Math.max(Number.isFinite(age) ? age : range.start, range.start), range.end);
    const getPercent = (age) => {
      if (!range.span) return 0;
      const clamped = clampAge(age);
      return ((clamped - range.start) / range.span) * 100;
    };
    const toPercent = (age) => `${getPercent(age)}%`;
    const flagColor = (flag) => {
      if (flag === 'H') return 'bg-amber-400 border-amber-200';
      if (flag === 'L') return 'bg-rose-400 border-rose-200';
      return 'bg-emerald-400 border-emerald-100';
    };
    const flagLabel = (flag) => {
      if (flag === 'H') return 'High';
      if (flag === 'L') return 'Low';
      return 'Normal';
    };
    const getFloatingTooltipStyle = () => {
      if (!hoveredLabTooltip) return {};
      const tooltipWidth = 220;
      const tooltipHeight = 100;
      const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 720;
      let left = hoveredLabTooltip.clientX + 16;
      let top = hoveredLabTooltip.clientY - tooltipHeight - 12;

      if (left + tooltipWidth > viewportWidth - 12) {
        left = hoveredLabTooltip.clientX - tooltipWidth - 16;
      }
      if (left < 12) {
        left = 12;
      }

      if (top < 12) {
        top = hoveredLabTooltip.clientY + 16;
      }
      if (top + tooltipHeight > viewportHeight - 12) {
        top = Math.max(12, viewportHeight - tooltipHeight - 12);
      }

      return { left, top };
    };

    return (
      <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
        <div className="flex flex-col gap-4 mb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h4 className="text-lg font-semibold text-gray-700">Lab Timeline</h4>
            <p className="text-xs text-gray-500">
              Each dot represents a lab result at a specific age.
            </p>
            </div>
            <div className="flex items-center text-xs text-gray-600 space-x-2">
              <span className="uppercase tracking-wide">Sort</span>
              <select
                className="border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                value={labTimelineSort}
                onChange={(e) => setLabTimelineSort(e.target.value)}
              >
                <option value="recent">Most recent → oldest</option>
                <option value="oldest">Oldest → most recent</option>
                <option value="alpha">A → Z</option>
              </select>
            </div>
          </div>

        <div
          className="relative h-6 mb-5 border-t border-dashed border-gray-200"
          style={TIMELINE_AXIS_STYLE}
        >
          {ticks.map((tick) => (
            <div
              key={tick.age}
              className="absolute -translate-x-1/2 text-[10px] text-gray-400 text-center"
              style={{ left: toPercent(tick.age) }}
            >
              <div className="w-px h-3 bg-gray-300 mx-auto mb-1"></div>
              {tick.label}
                  </div>
                ))}
            </div>

        <div className="relative">
          <div 
            className="space-y-3 max-h-[420px] overflow-y-auto pr-2"
            onScroll={(e) => handleScroll(e, 'labTimeline')}
            ref={(el) => checkInitialScrollState(el, 'labTimeline')}
          >
          {labTimelineRows.map((row, idx) => {
            const rowKey = row.key || `${row.testName || row.component || 'Lab'}-${idx}`;
            const labelText = `${row.testName}${
              row.component && row.component !== row.testName ? ` • ${row.component}` : ''
            }${row.unit ? ` (${row.unit})` : ''}`;
            return (
                <div key={rowKey} className="mb-4">
                  <div className="mb-1">
                  <TimelineLabel
                    text={labelText}
                  />
          </div>
                  <div className="relative h-10 bg-gray-50 rounded">
                  {row.results.map((result, resultIdx) => {
                    const leftPercent = getPercent(result.ageInDays);
                    const tooltipValue = result.result ?? result.numericValue ?? 'N/A';
                    const unitText = row.unit || result.unit;
                    const testName = row.testName || result.testName || 'Lab Result';
                    const component = row.component || result.component;
                    return (
                      <div
                        key={`${rowKey}-${result.ageInDays}-${resultIdx}`}
                        className="absolute -translate-x-1/2 -translate-y-1/2"
                        style={{ left: `${leftPercent}%`, top: '50%' }}
                        onMouseEnter={(e) =>
                          setHoveredLabTooltip({
                            testName,
                            component,
                            value: tooltipValue,
                            unit: unitText,
                            ageInDays: result.ageInDays,
                            flag: result.flag,
                            clientX: e.clientX,
                            clientY: e.clientY
                          })
                        }
                        onMouseMove={(e) =>
                          setHoveredLabTooltip((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  clientX: e.clientX,
                                  clientY: e.clientY
                                }
                              : prev
                          )
                        }
                        onMouseLeave={() => setHoveredLabTooltip(null)}
                        title={`${testName}${unitText ? ` (${unitText})` : ''}\n${tooltipValue}${
                          unitText ? ` ${unitText}` : ''
                        } at ${formatAge(result.ageInDays)}${
                          result.flag ? ` · ${result.flag === 'H' ? 'High' : 'Low'}` : ''
                        }`}
                      >
                        <span
                          className={`block w-3 h-3 rounded-full border ${flagColor(result.flag)}`}
                        ></span>
            </div>
                    );
                  })}
          </div>
              </div>
            );
          })}
          </div>
          {!scrolledToBottom.labTimeline && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
          )}
        </div>
        {hoveredLabTooltip && (
          <div
            className="pointer-events-none fixed z-[9999] px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-lg text-xs text-gray-700"
            style={getFloatingTooltipStyle()}
          >
            <p className="text-[11px] font-semibold text-gray-900">
              {hoveredLabTooltip.testName}
            </p>
            {hoveredLabTooltip.component && (
              <p className="text-[10px] text-gray-500">{hoveredLabTooltip.component}</p>
            )}
            <p className="text-sm text-gray-800 mt-1">
              {hoveredLabTooltip.value}
              {hoveredLabTooltip.unit ? ` ${hoveredLabTooltip.unit}` : ''}
            </p>
            <p className="text-[10px] text-gray-500 mt-0.5">
              Age: {formatAge(hoveredLabTooltip.ageInDays)}
            </p>
          </div>
        )}
      </div>
    );
  };

  const renderPhysicianSummaryPanel = () => {
    if (!selectedPatient) {
      return null;
    }

    if (isPhysicianSummaryPanelCollapsed) {
      return (
        <button
          type="button"
          className="fixed bottom-6 right-6 z-40 flex items-center space-x-3 bg-indigo-600 text-white px-4 py-3 rounded-full shadow-lg hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          onClick={() => setIsPhysicianSummaryPanelCollapsed(false)}
        >
          <Clipboard className="w-5 h-5" />
          <div className="text-left">
            <p className="text-[10px] uppercase tracking-wide text-indigo-100">Summarize</p>
            <p className="text-sm font-semibold leading-4">{selectedPatient.patientId}</p>
          </div>
        </button>
      );
    }

    return (
      <div className="fixed bottom-6 right-6 z-40 max-w-full">
        <div
          className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden relative flex flex-col"
          style={{
            width: `${physicianSummaryPanelSize.width}px`,
            height: `${physicianSummaryPanelSize.height}px`
          }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div>
              <p className="text-xs uppercase tracking-wide text-gray-400">Physician Summary</p>
              <p className="font-semibold text-gray-900">{selectedPatient.patientId}</p>
                      </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-3 text-xs text-gray-500">
              {physicianSummaryMeta?.savedAt && (
                <span>
                  Saved {new Date(physicianSummaryMeta.savedAt).toLocaleString()}
                </span>
              )}
              {physicianSummaryMeta?.author && (
                <span className="sm:mt-0 mt-1">
                  By {physicianSummaryMeta.author.charAt(0).toUpperCase() + physicianSummaryMeta.author.slice(1)}
                </span>
              )}
            <button
                type="button"
                onClick={() => setIsPhysicianSummaryPanelCollapsed(true)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Minimize summary panel"
              >
                <ChevronDown className="w-5 h-5" />
            </button>
                  </div>
                </div>
          <form
            onSubmit={handlePhysicianSummarySubmit}
            className="p-4 space-y-4 flex-1 flex flex-col overflow-hidden"
          >
            <div className="flex-1 flex flex-col">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Summary notes {currentUser && (
                    <span className="ml-2 normal-case text-gray-400 text-[11px]">(Logged in as {currentUser})</span>
                  )}
                </label>
                {/* Timer display */}
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-mono ${
                  summaryTimerStart 
                    ? 'bg-green-50 text-green-700 border border-green-200' 
                    : 'bg-gray-50 text-gray-400 border border-gray-200'
                }`}>
                  <ClockIcon className="w-3.5 h-3.5" />
                  <span>{formatElapsedTime(summaryElapsedTime)}</span>
                  {!summaryTimerStart && <span className="text-[10px] ml-1">(starts on typing)</span>}
                </div>
              </div>
              <div className="relative mt-1">
              <textarea
                value={physicianSummaryText}
                onChange={handleSummaryTextChange}
                  className={`w-full flex-1 rounded-xl border text-sm p-3 pr-12 resize-none min-h-[220px] ${
                    isDictating 
                      ? 'border-red-400 ring-2 ring-red-200 focus:border-red-500 focus:ring-red-300' 
                      : 'border-gray-200 focus:border-indigo-500 focus:ring-indigo-500'
                  }`}
                  placeholder={isDictating ? "Listening... speak now" : "Capture the key aspects of the recent visits, interventions, and next steps."}
                />
                <button
                  type="button"
                  onClick={toggleDictation}
                  className={`absolute top-2 right-2 p-2 rounded-lg transition-all ${
                    isDictating 
                      ? 'bg-red-500 text-white animate-pulse hover:bg-red-600' 
                      : 'bg-gray-100 text-gray-600 hover:bg-indigo-100 hover:text-indigo-600'
                  }`}
                  title={isDictating ? "Stop dictation" : "Start dictation"}
                >
                  <MicrophoneIcon className="w-5 h-5" />
                </button>
                {isDictating && (
                  <div className="absolute bottom-2 left-3 flex items-center gap-2 text-xs text-red-600">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                    Recording...
                  </div>
                )}
              </div>
          </div>

            {physicianSummaryStatus && (
              <div
                className={`text-sm ${
                  physicianSummaryStatus.type === 'error' ? 'text-red-600' : 'text-green-600'
                }`}
              >
                {physicianSummaryStatus.message}
            </div>
          )}

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSavingPhysicianSummary}
                className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold shadow hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSavingPhysicianSummary ? 'Saving...' : 'Save Summary'}
              </button>
                  </div>
          </form>

          <div className="absolute inset-0 pointer-events-none">
            <div
              className="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 h-16 w-2 cursor-col-resize pointer-events-auto bg-indigo-200 rounded-full opacity-0 hover:opacity-70 transition-opacity"
              onMouseDown={startSummaryPanelResize('left')}
            ></div>
            <div
              className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-2 cursor-row-resize pointer-events-auto bg-indigo-200 rounded-full opacity-0 hover:opacity-70 transition-opacity"
              onMouseDown={startSummaryPanelResize('top')}
            ></div>
            <div
              className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-indigo-400 rounded-full cursor-nw-resize pointer-events-auto shadow"
              onMouseDown={startSummaryPanelResize('corner')}
            ></div>
                      </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-500 text-center">
          <h3 className="text-xl font-bold mb-2">Error Loading Data</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!patientData.length) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 text-center">
          <h3 className="text-xl font-bold mb-2">No Patient Data Available</h3>
          <p>Please check if the CSV file is properly formatted and contains data.</p>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="container mx-auto px-4 py-8">
      {/* Search Bar */}
      <div className="relative mb-6">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
        </div>
        <input
          type="text"
          className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          placeholder="Search patients by ID, sex, or ethnicity..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Patient Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {filteredPatients.map(patient => (
          <div
            key={patient.patientId}
            onClick={() => {
              console.log('Selecting patient:', patient.patientId);
              setSelectedPatient(patient);
              setActiveSection('timeline');
              // Scroll to the dashboard section
              setTimeout(() => {
                document.querySelector('#patientDashboard')?.scrollIntoView({ behavior: 'smooth' });
              }, 100);
            }}
            className={`w-full text-left p-4 rounded-lg transition-all duration-200 cursor-pointer ${
              selectedPatient?.patientId === patient.patientId
                ? 'bg-indigo-50 border-2 border-indigo-500 shadow-lg'
                : 'bg-white hover:bg-gray-50 border-2 border-transparent hover:border-gray-200'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div className="flex-shrink-0">
                <UserGroupIcon className="h-6 w-6 text-indigo-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{patient.patientId}</h3>
                <p className="text-sm text-gray-500">
                  {patient.sex} • {patient.ethnicity}
                </p>
              </div>
            </div>
            
            <div className="mt-4 space-y-2">
              <div className="flex items-center text-sm text-gray-600">
                <ChartBarIcon className="h-4 w-4 mr-1" />
                <span>{patient.visits.length} visits</span>
              </div>
              <div className="flex items-center text-sm text-gray-600">
                <ClockIcon className="h-4 w-4 mr-1" />
                <span>Age: {formatAge(Math.max(...patient.visits.map(v => v.ageInDays)))}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Selected Patient Details */}
      {selectedPatient && (
        <div id="patientDashboard" className="bg-white rounded-lg shadow-md p-6 mt-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-3xl font-bold text-indigo-800">Patient Journey</h1>
              <h2 className="text-xl text-gray-600">
                ID: {selectedPatient.patientId} • {selectedPatient.sex} • {selectedPatient.ethnicity}
              </h2>
            </div>
            <div className="bg-indigo-100 p-3 rounded-lg">
              <p className="text-indigo-800 font-semibold">
                Current Age: {formatAge(Math.max(...selectedPatient.visits.map(v => v.ageInDays)))}
              </p>
              <p className="text-gray-600 text-sm">
                First Visit: {formatAge(Math.min(...selectedPatient.visits.map(v => v.ageInDays)))}
              </p>
            </div>
          </div>

          {/* Global Visit Filter */}
          <div className="flex items-center justify-end mb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Viewing:</span>
              <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
                <button
                  onClick={() => setVisitTimelineLimit('all')}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    visitTimelineLimit === 'all'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  All Visits ({selectedPatient.visits.length})
                </button>
                <button
                  onClick={() => setVisitTimelineLimit('10')}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors border-l border-gray-300 ${
                    visitTimelineLimit === '10'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Last 10 Visits
                </button>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex justify-between mb-6">
            <button 
              onClick={() => setActiveSection('timeline')}
              className={`flex items-center px-4 py-2 rounded-lg ${activeSection === 'timeline' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              <Calendar className="w-4 h-4 mr-2" />
              Visit Timeline
            </button>
            <button
              onClick={() => setActiveSection('integratedTimeline')}
              className={`flex items-center px-4 py-2 rounded-lg ${activeSection === 'integratedTimeline' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              <ChartBarIcon className="w-4 h-4 mr-2" />
              Visual Timeline
            </button>
            <button 
              onClick={() => setActiveSection('diagnoses')}
              className={`flex items-center px-4 py-2 rounded-lg ${activeSection === 'diagnoses' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              <Stethoscope className="w-4 h-4 mr-2" />
              Diagnoses
            </button>
            <button 
              onClick={() => setActiveSection('medications')}
              className={`flex items-center px-4 py-2 rounded-lg ${activeSection === 'medications' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              <Pill className="w-4 h-4 mr-2" />
              Medications
            </button>
            <button 
              onClick={() => setActiveSection('growth')}
              className={`flex items-center px-4 py-2 rounded-lg ${activeSection === 'growth' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              <Activity className="w-4 h-4 mr-2" />
              Growth
            </button>
            <button 
              onClick={() => setActiveSection('labs')}
              className={`flex items-center px-4 py-2 rounded-lg ${activeSection === 'labs' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              <Clipboard className="w-4 h-4 mr-2" />
              Labs
            </button>
            <button 
              onClick={() => setActiveSection('problems')}
              className={`flex items-center px-4 py-2 rounded-lg ${activeSection === 'problems' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              <Stethoscope className="w-4 h-4 mr-2" />
              Problems
            </button>
            <button 
              onClick={() => setActiveSection('referrals')}
              className={`flex items-center px-4 py-2 rounded-lg ${activeSection === 'referrals' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              <UserGroupIcon className="w-4 h-4 mr-2" />
              Referrals
            </button>
          </div>

          {/* Content Sections */}
          {activeSection === 'timeline' && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-800">Visit Timeline</h3>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Sort:</span>
                  <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
                    <button
                      onClick={() => setVisitTimelineSort('desc')}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                        visitTimelineSort === 'desc'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      Newest First
                    </button>
                    <button
                      onClick={() => setVisitTimelineSort('asc')}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors border-l border-gray-300 ${
                        visitTimelineSort === 'asc'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      Oldest First
                    </button>
                  </div>
                </div>
              </div>
              <div className="relative bg-gray-100 rounded-lg p-4 h-[800px]">
                <div className="absolute left-14 top-0 bottom-0 w-1 bg-indigo-200"></div>
                
                <div 
                  className="overflow-y-auto h-full pr-4"
                  onScroll={(e) => handleScroll(e, 'visitTimeline')}
                  ref={(el) => checkInitialScrollState(el, 'visitTimeline')}
                >
                  {[...filteredVisits].sort((a, b) => 
                    visitTimelineSort === 'desc' ? b.ageInDays - a.ageInDays : a.ageInDays - b.ageInDays
                  ).map(visit => {
                    // Get active problems at this time
                    const activeProblems = prepareProblemResolutionData(
                      selectedPatient.visits.filter(v => v.ageInDays <= visit.ageInDays)
                    ).filter(problem => !problem.resolved);

                    // Get problems resolved at this visit
                    const resolvedProblems = prepareProblemResolutionData(
                      selectedPatient.visits.filter(v => v.ageInDays <= visit.ageInDays)
                    ).filter(problem => 
                      problem.resolved && 
                      problem.lastSeen === visit.ageInDays / 365  // Problem's last appearance matches this visit day
                    );

                    // Get active medications at this time
                    const activeMedications = prepareMedicationsForGantt(filteredVisits)
                      .filter(med => {
                        const mostRecentVisitAge = Math.max(...selectedPatient.visits.map(v => v.ageInDays));
                        return med.start <= visit.ageInDays && 
                          (med.end === 'ongoing' || (med.end >= visit.ageInDays && med.end <= mostRecentVisitAge));
                      });

                    // Get lab results from this visit
                    const labResults = visit.labs;

                    return (
                      <div 
                        key={visit.visitId} 
                        className="flex mb-6 relative"
                        onClick={() => {
                          setSelectedVisit(visit);
                          setModalContent({
                            title: `Visit Details - ${formatAge(visit.ageInDays)}`,
                            content: (
                              <div className="space-y-6">
                                {/* Visit Info */}
                                <div className="bg-gray-50 p-4 rounded-lg">
                                  <h4 className="font-semibold text-lg mb-2">{visit.encounterType}</h4>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div>
                                      <p className="text-sm text-gray-600">Age at Visit</p>
                                      <p className="font-medium">{formatAge(visit.ageInDays)}</p>
                                    </div>
                                    {visit.weight && (
                                      <div>
                                        <p className="text-sm text-gray-600">Weight</p>
                                        <p className="font-medium">{(visit.weight/16).toFixed(1)} lbs</p>
                                      </div>
                                    )}
                                    <div>
                                      <p className="text-sm text-gray-600">Height</p>
                                      {visit.height ? (
                                        <p className="font-medium">{visit.height}" tall</p>
                                      ) : (
                                        <div>
                                          <p className="text-sm text-red-600 font-medium">Height not recorded</p>
                                          {(() => {
                                            const previousVisits = selectedPatient.visits.filter(v => v.ageInDays < visit.ageInDays);
                                            const lastRecordedHeight = previousVisits.length > 0 ? 
                                              [...previousVisits].sort((a, b) => b.ageInDays - a.ageInDays).find(v => v.height)?.height : null;
                                            return lastRecordedHeight && (
                                              <p className="text-xs text-gray-600 mt-1">
                                                Last recorded: {lastRecordedHeight}"
                                              </p>
                                            );
                                          })()}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Diagnoses */}
                                <div>
                                  <h5 className="font-semibold mb-2">Diagnoses at Visit</h5>
                                  <div className="flex flex-wrap gap-2">
                                    {visit.diagnoses.map((code, idx) => renderDiagnosisCode(code, `modal-diag-${visit.visitId}-${code}-${idx}`))}
                                  </div>
                                </div>

                                {/* Active Problems */}
                                <div>
                                  <h5 className="font-semibold mb-2">Active Problems</h5>
                                  <div className="bg-yellow-50 p-3 rounded-lg">
                                    {activeProblems.length > 0 ? (
                                      <div className="grid gap-2">
                                        {activeProblems.map((problem, idx) => (
                                          <div key={idx} className="flex justify-between items-center">
                                            {renderProblemWithTooltip(problem, `modal-active-${visit.visitId}-${problem.code}-${idx}`)}
                                            <span className="text-xs text-gray-600">
                                              Since: {formatAge(problem.firstSeen * 365)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-sm text-gray-600">No active problems</p>
                                    )}
                                  </div>
                                </div>

                                {/* Problems Resolved Section */}
                                {resolvedProblems.length > 0 && (
                                  <div>
                                    <h5 className="font-semibold mb-2">Problems Resolved</h5>
                                    <div className="bg-green-50 p-3 rounded-lg">
                                      <div className="grid gap-2">
                                        {resolvedProblems.map((problem, idx) => (
                                          <div key={idx} className="flex justify-between items-center">
                                            {renderProblemWithTooltip(problem, `modal-resolved-${visit.visitId}-${problem.code}-${idx}`)}
                                            <span className="text-xs text-gray-600">
                                              Duration: {Math.round(problem.duration * 365)} days
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Active Medications */}
                                <div>
                                  <h5 className="font-semibold mb-2">Active Medications</h5>
                                  <div className="bg-green-50 p-3 rounded-lg">
                                    {activeMedications.length > 0 ? (
                                      <div className="grid gap-2">
                                        {activeMedications.map((med, idx) => (
                                          <div key={idx} className="flex justify-between items-center">
                                            <span className="text-sm">{med.name}</span>
                                            <span className="text-xs text-gray-600">
                                              Started: {formatAge(med.start)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-sm text-gray-600">No active medications</p>
                                    )}
                                  </div>
                                </div>

                                {/* Lab Results */}
                                {labResults.length > 0 && (
                                  <div>
                                    <h5 className="font-semibold mb-2">Lab Results</h5>
                                    <div className="bg-blue-50 p-3 rounded-lg">
                                      <div className="grid gap-2">
                                        {labResults.map((lab, idx) => (
                                          <div key={idx} className="flex items-center justify-between">
                                            <div>
                                              <span className="text-sm font-medium">{lab.testName}</span>
                                              <span className="text-xs text-gray-600 ml-2">({lab.component})</span>
                                            </div>
                                              <span className="text-sm">{lab.result}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Referrals */}
                                {visit.referrals_details && (
                                  <div>
                                    <h5 className="font-semibold mb-2">Referrals</h5>
                                    <div className="bg-purple-50 p-3 rounded-lg">
                                      {visit.referrals_details.split(';').map((referral, idx) => (
                                        <div key={idx} className="text-sm">
                                          {referral.trim()}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          });
                          setIsModalOpen(true);
                        }}
                      >
                        <div className="absolute left-14 top-6 w-4 h-4 rounded-full bg-indigo-500 transform -translate-x-1/2"></div>
                        <div className="w-14 text-right pr-4 pt-4">
                          <span className="text-gray-600 text-sm font-medium">{formatAge(visit.ageInDays)}</span>
                        </div>
                        <div className="flex-1 bg-white rounded-lg shadow-sm p-4 ml-6">
                          <div className="flex justify-between items-start">
                            <div>
                              <h4 className="font-bold text-indigo-700">{visit.encounterType}</h4>
                            </div>
                            <div className="flex items-center space-x-2 flex-shrink-0">
                              {visit.weight ? (
                                <span className="bg-gray-100 px-2 py-1 rounded text-sm min-w-[80px] text-center">
                                  {(visit.weight/16).toFixed(1)} lbs
                                </span>
                              ) : (
                                <span className="bg-gray-100 px-2 py-1 rounded text-sm min-w-[80px] text-center text-gray-400">
                                  — lbs
                                </span>
                              )}
                              {visit.height ? (
                                <span className="bg-gray-100 px-2 py-1 rounded text-sm min-w-[140px] text-center">
                                  {visit.height}" tall
                                </span>
                              ) : (
                                <span className="bg-red-50 text-red-600 px-2 py-1 rounded text-sm font-medium min-w-[140px] text-center">
                                  Height not recorded
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Diagnoses Section */}
                          {visit.diagnoses.length > 0 && (
                            <div className="mt-2">
                              <h5 className="text-gray-700 text-sm font-medium">Diagnoses:</h5>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {visit.diagnoses.map((code, idx) => renderDiagnosisCode(code, `timeline-diag-${visit.visitId}-${code}-${idx}`))}
                              </div>
                            </div>
                          )}

                          {/* Active Problems Summary */}
                          {activeProblems.length > 0 && (
                            <div className="mt-2">
                              <h5 className="text-gray-700 text-sm font-medium">Active Problems:</h5>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {activeProblems.map((problem, idx) => {
                                  const uniqueId = `timeline-active-${visit.visitId}-${problem.code}-${idx}`;
                                  return (
                                    <span 
                                      key={idx} 
                                      className="inline-block bg-yellow-50 text-yellow-800 px-2 py-1 text-xs rounded cursor-help"
                                      onMouseEnter={(e) => handleICDTooltipEnter(e, problem.code, uniqueId, problem.problem)}
                                      onMouseLeave={() => setHoveredCode(null)}
                                    >
                                    {problem.problem}
                                  </span>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Problems Resolved Summary */}
                          {resolvedProblems.length > 0 && (
                            <div className="mt-2">
                              <h5 className="text-gray-700 text-sm font-medium">Problems Resolved:</h5>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {resolvedProblems.map((problem, idx) => {
                                  const uniqueId = `timeline-resolved-${visit.visitId}-${problem.code}-${idx}`;
                                  return (
                                    <span 
                                      key={idx} 
                                      className="inline-block bg-green-50 text-green-800 px-2 py-1 text-xs rounded cursor-help"
                                      onMouseEnter={(e) => handleICDTooltipEnter(e, problem.code, uniqueId, problem.problem)}
                                      onMouseLeave={() => setHoveredCode(null)}
                                    >
                                    {problem.problem} ({Math.round(problem.duration * 365)} days)
                                  </span>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Medications Section */}
                          {visit.medications.length > 0 && (
                            <div className="mt-2">
                              <h5 className="text-gray-700 text-sm font-medium">Medications Prescribed:</h5>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {visit.medications.map((med, idx) => (
                                  <span key={idx} className="inline-block bg-green-50 text-green-800 px-2 py-1 text-xs rounded">
                                    {med.name} (Start: {formatAge(med.start)}{med.end === 'ongoing' ? 
                                      ' - Ongoing' : 
                                      ` - End: ${formatAge(med.end)}`})
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Active Medications Section */}
                          {activeMedications.length > 0 && (
                            <div className="mt-2">
                              <h5 className="text-gray-700 text-sm font-medium">Active Medications at Visit:</h5>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {activeMedications.map((med, idx) => (
                                  <span key={idx} className="inline-block bg-blue-50 text-blue-800 px-2 py-1 text-xs rounded">
                                    {med.name} (Start: {formatAge(med.start)}{med.end === 'ongoing' ? 
                                      ' - Ongoing' : 
                                      ` - End: ${formatAge(med.end)}`})
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Lab Results Summary */}
                          {labResults.length > 0 && (
                            <div className="mt-2">
                              <h5 className="text-gray-700 text-sm font-medium">Lab Results:</h5>
                              <div className="mt-1">
                                <div className={`p-3 rounded-lg bg-gray-50`}>
                                  <div className="space-y-2">
                                    {labResults.map((lab, idx) => (
                                      <div key={idx} className="flex items-center justify-between">
                                        <div className="flex items-center space-x-2">
                                          <span className="font-medium text-sm">{lab.testName}</span>
                                          <span className="text-sm text-gray-600">({lab.component})</span>
                                        </div>
                                          <span className="text-sm">{lab.result}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Referrals Summary */}
                          {visit.referrals_details && (
                            <div className="mt-2">
                              <h5 className="text-gray-700 text-sm font-medium">Referrals:</h5>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {visit.referrals_details.split(';').map((referral, idx) => (
                                  <span key={idx} className="inline-block bg-purple-50 text-purple-800 px-2 py-1 text-xs rounded">
                                    {referral.trim()}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!scrolledToBottom.visitTimeline && filteredVisits.length > 0 && (
                  <div className="absolute bottom-4 left-4 right-4 h-16 bg-gradient-to-t from-gray-100 to-transparent pointer-events-none rounded-b-lg"></div>
                )}
              </div>
            </div>
          )}

          {activeSection === 'diagnoses' && (
            <div>
              <h3 className="text-xl font-bold text-gray-800 mb-4">Diagnosis Insights</h3>
              
              {/* Most Frequent Diagnoses - at the top */}
              <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
                <h4 className="text-lg font-semibold text-gray-700 mb-3">Most Frequent Diagnoses</h4>
                  {diagnosisInsights.topDiagnoses.length === 0 ? (
                    <p className="text-sm text-gray-500">No diagnoses recorded for this patient.</p>
                  ) : (
                  <div className="flex flex-wrap gap-2">
                    {diagnosisInsights.topDiagnoses.map((diag) => (
                      <div 
                        key={diag.code} 
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded-lg text-sm whitespace-nowrap"
                      >
                        <span className="font-medium text-gray-700">
                          {diag.description}
                        </span>
                        <span className="px-1.5 py-0.5 bg-indigo-600 text-white text-xs font-semibold rounded">
                          {diag.count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Diagnosis Activity Timeline - similar to Medication Activity Timeline */}
              {diagnosisInsights.timeline.length > 0 && (
                <div className="bg-white rounded-lg shadow-sm p-4 mt-6">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
                    <div>
                      <h4 className="text-lg font-semibold text-gray-700">Diagnosis Activity Timeline</h4>
                      <p className="text-xs text-gray-400 italic">The same diagnosis may appear multiple times.</p>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="text-xs text-gray-500">
                        {formatAge(diagnosisInsights.timelineRange.start)} → {formatAge(diagnosisInsights.timelineRange.end)}
                      </div>
                      <label className="flex items-center text-xs text-gray-500">
                        <span className="mr-2">Sort by</span>
                        <select
                          className="border rounded px-2 py-1 text-xs bg-white"
                          value={diagnosisTimelineSort}
                          onChange={(e) => setDiagnosisTimelineSort(e.target.value)}
                        >
                          <option value="last">Most Recent</option>
                          <option value="first">Oldest First</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="relative">
                    <div 
                      className="space-y-4 max-h-[800px] overflow-y-auto"
                      onScroll={(e) => handleScroll(e, 'diagnosisTimeline')}
                      ref={(el) => checkInitialScrollState(el, 'diagnosisTimeline')}
                    >
                      {sortedDiagnosisTimeline.map((entry, idx) => {
                        const span = diagnosisInsights.timelineRange.span || 1;
                        const rawStartPercentage = span ? ((entry.firstAge - diagnosisInsights.timelineRange.start) / span) * 100 : 0;
                        const minWidth = 3;
                        const startPercentage = Math.max(0, Math.min(100 - minWidth, rawStartPercentage));
                        const widthPercentage = Math.max(minWidth, Math.min(100 - startPercentage, ((entry.duration || 1) / span) * 100));
                      return (
                          <div key={entry.diagnosisId || `${entry.code}-${idx}`}>
                          <div className="flex justify-between text-sm font-medium text-gray-700">
                            <div>
                                <p>{entry.description}</p>
                                <p className="text-xs text-gray-500">Code: {entry.code}</p>
                  </div>
                              <div className="text-xs text-gray-500 text-right">
                                <p>Age: {formatAge(entry.firstAge)}</p>
                </div>
                            </div>
                            <div className="relative mt-2 h-3 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="absolute top-0 h-full bg-indigo-500 rounded-full"
                                style={{
                                  left: `${startPercentage}%`,
                                  width: `${widthPercentage}%`
                                }}
                            ></div>
                          </div>
                        </div>
                      );
                      })}
                  </div>
                    {!scrolledToBottom.diagnosisTimeline && (
                      <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
                    )}
                </div>
              </div>
              )}

              {/* Diagnosis Details Table */}
                <div className="bg-white rounded-lg shadow-lg p-6 mt-6">
                <div className="flex justify-between items-center mb-4">
                    <div>
                    <h4 className="text-lg font-semibold text-gray-700">Diagnosis Details</h4>
                    <p className="text-xs text-gray-400 italic">The same diagnosis may appear multiple times.</p>
                    </div>
                  <label className="flex items-center text-xs text-gray-500">
                    <span className="mr-2">Sort by</span>
                    <select
                      className="border rounded px-2 py-1 text-xs bg-white"
                      value={diagnosisTimelineSort}
                      onChange={(e) => setDiagnosisTimelineSort(e.target.value)}
                    >
                      <option value="last">Most Recent</option>
                      <option value="first">Oldest First</option>
                    </select>
                  </label>
                    </div>
                <div className="relative">
                  <div 
                    className="overflow-auto max-h-[600px]"
                    onScroll={(e) => handleScroll(e, 'diagnosisTable')}
                    ref={(el) => checkInitialScrollState(el, 'diagnosisTable')}
                  >
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Diagnosis</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Age at Diagnosis</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {sortedDiagnosisTimeline.map((entry, idx) => (
                          <tr 
                            key={entry.diagnosisId || `${entry.code}-${idx}`}
                            className="hover:bg-gray-50 transition-colors"
                          >
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {entry.description}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {entry.code}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {formatAge(entry.firstAge)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!scrolledToBottom.diagnosisTable && (
                    <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
                  )}
                    </div>
                  </div>
            </div>
          )}

          {activeSection === 'growth' && (() => {
            // Helper to get percentile data for a specific metric
            const getGrowthChartData = (metricType) => {
              if (!growthPercentiles || !selectedPatient) return { percentileData: null, patientData: [] };
              
              const sex = selectedPatient.sex?.toLowerCase() === 'f' || selectedPatient.sex?.toLowerCase() === 'female' ? 'female' : 'male';
              const patientData = prepareGrowthData();
              
              // For weight and height, combine both infant (0-36 months) and child (2-20 years) datasets
              // to cover the full age range
              let combinedPercentileData = [];
              
              if (metricType === 'weight') {
                const infantData = growthPercentiles['weight_0_to_36']?.[sex] || [];
                const childData = growthPercentiles['weight_2_to_20']?.[sex] || [];
                // Combine: use infant data for ages < 730 days (2 years), child data for ages >= 730
                combinedPercentileData = [
                  ...infantData.filter(d => d.ageInDays < 730),
                  ...childData
                ].sort((a, b) => a.ageInDays - b.ageInDays);
              } else if (metricType === 'height') {
                const infantData = growthPercentiles['length_0_to_36']?.[sex] || [];
                const childData = growthPercentiles['height_2_to_20']?.[sex] || [];
                combinedPercentileData = [
                  ...infantData.filter(d => d.ageInDays < 730),
                  ...childData
                ].sort((a, b) => a.ageInDays - b.ageInDays);
              } else if (metricType === 'bmi') {
                // BMI only has 2-20 years data
                combinedPercentileData = growthPercentiles['bmi_2_to_20']?.[sex] || [];
              }
              
              if (combinedPercentileData.length === 0) {
                return { percentileData: null, patientData };
              }
              
              return { percentileData: combinedPercentileData, patientData };
            };

            const { percentileData: weightPercentiles, patientData: weightPatientData } = getGrowthChartData('weight');
            const { percentileData: heightPercentiles, patientData: heightPatientData } = getGrowthChartData('height');
            const { percentileData: bmiPercentiles } = getGrowthChartData('bmi');

            // Percentile colors - gradient from light to dark and back
            const percentileStyles = {
              P3: { color: '#94a3b8', dash: '4 2' },
              P10: { color: '#64748b', dash: '4 2' },
              P25: { color: '#475569', dash: '3 2' },
              P50: { color: '#1e293b', dash: null },
              P75: { color: '#475569', dash: '3 2' },
              P90: { color: '#64748b', dash: '4 2' },
              P97: { color: '#94a3b8', dash: '4 2' }
            };

            return (
            <div>
              <h3 className="text-xl font-bold text-gray-800 mb-4">Growth & Development</h3>
              <p className="text-sm text-gray-500 mb-4">CDC growth percentile curves shown for reference ({selectedPatient?.sex === 'F' ? 'Female' : 'Male'})</p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-lg shadow-sm p-4">
                  <h4 className="text-lg font-semibold text-gray-700 mb-2">Weight Over Time</h4>
                  <div className="h-96">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis 
                          dataKey="ageInDays" 
                          type="number"
                          domain={['dataMin', 'dataMax']}
                          tickFormatter={formatAgeCompact}
                          allowDuplicatedCategory={false}
                        />
                        <YAxis 
                          domain={['auto', 'auto']}
                          tickFormatter={(v) => `${v} lbs`}
                          width={70}
                        />
                        <Tooltip 
                          formatter={(value, name) => {
                            if (name === 'Patient Weight') return [`${value?.toFixed(1)} lbs`, name];
                            return [`${value?.toFixed(1)} lbs`, name];
                          }}
                          labelFormatter={(value) => `Age: ${formatAge(value)}`}
                        />
                        {/* CDC Percentile curves */}
                        {weightPercentiles && (
                          <>
                            <Line data={weightPercentiles} type="natural" dataKey="P3" stroke={percentileStyles.P3.color} strokeDasharray={percentileStyles.P3.dash} strokeWidth={1} dot={false} name="3rd" connectNulls />
                            <Line data={weightPercentiles} type="natural" dataKey="P10" stroke={percentileStyles.P10.color} strokeDasharray={percentileStyles.P10.dash} strokeWidth={1} dot={false} name="10th" connectNulls />
                            <Line data={weightPercentiles} type="natural" dataKey="P25" stroke={percentileStyles.P25.color} strokeDasharray={percentileStyles.P25.dash} strokeWidth={1} dot={false} name="25th" connectNulls />
                            <Line data={weightPercentiles} type="natural" dataKey="P50" stroke={percentileStyles.P50.color} strokeWidth={2} dot={false} name="50th (median)" connectNulls />
                            <Line data={weightPercentiles} type="natural" dataKey="P75" stroke={percentileStyles.P75.color} strokeDasharray={percentileStyles.P75.dash} strokeWidth={1} dot={false} name="75th" connectNulls />
                            <Line data={weightPercentiles} type="natural" dataKey="P90" stroke={percentileStyles.P90.color} strokeDasharray={percentileStyles.P90.dash} strokeWidth={1} dot={false} name="90th" connectNulls />
                            <Line data={weightPercentiles} type="natural" dataKey="P97" stroke={percentileStyles.P97.color} strokeDasharray={percentileStyles.P97.dash} strokeWidth={1} dot={false} name="97th" connectNulls />
                          </>
                        )}
                        {/* Patient's actual weight */}
                        <Line 
                          data={weightPatientData}
                          type="natural" 
                          dataKey="weight" 
                          stroke="#4F46E5" 
                          strokeWidth={3}
                          dot={{ r: 4, fill: '#4F46E5' }}
                          activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }}
                          name="Patient Weight"
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap justify-center gap-3 mt-2 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-slate-800"></span> 50th</span>
                    <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-slate-500 border-dashed"></span> 3rd/10th/25th/75th/90th/97th</span>
                    <span className="flex items-center gap-1"><span className="w-4 h-1 bg-indigo-600 rounded"></span> Patient</span>
                  </div>
                </div>
                
                <div className="bg-white rounded-lg shadow-sm p-4">
                  <h4 className="text-lg font-semibold text-gray-700 mb-2">Height Over Time</h4>
                  <div className="h-96">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis 
                          dataKey="ageInDays" 
                          type="number"
                          domain={['dataMin', 'dataMax']}
                          tickFormatter={formatAgeCompact}
                          allowDuplicatedCategory={false}
                        />
                        <YAxis 
                          domain={['auto', 'auto']}
                          tickFormatter={(v) => `${v}"`}
                          width={60}
                        />
                        <Tooltip 
                          formatter={(value, name) => {
                            if (name === 'Patient Height') return [`${value?.toFixed(1)}"`, name];
                            return [`${value?.toFixed(1)}"`, name];
                          }}
                          labelFormatter={(value) => `Age: ${formatAge(value)}`}
                        />
                        {/* CDC Percentile curves */}
                        {heightPercentiles && (
                          <>
                            <Line data={heightPercentiles} type="natural" dataKey="P3" stroke={percentileStyles.P3.color} strokeDasharray={percentileStyles.P3.dash} strokeWidth={1} dot={false} name="3rd" connectNulls />
                            <Line data={heightPercentiles} type="natural" dataKey="P10" stroke={percentileStyles.P10.color} strokeDasharray={percentileStyles.P10.dash} strokeWidth={1} dot={false} name="10th" connectNulls />
                            <Line data={heightPercentiles} type="natural" dataKey="P25" stroke={percentileStyles.P25.color} strokeDasharray={percentileStyles.P25.dash} strokeWidth={1} dot={false} name="25th" connectNulls />
                            <Line data={heightPercentiles} type="natural" dataKey="P50" stroke={percentileStyles.P50.color} strokeWidth={2} dot={false} name="50th (median)" connectNulls />
                            <Line data={heightPercentiles} type="natural" dataKey="P75" stroke={percentileStyles.P75.color} strokeDasharray={percentileStyles.P75.dash} strokeWidth={1} dot={false} name="75th" connectNulls />
                            <Line data={heightPercentiles} type="natural" dataKey="P90" stroke={percentileStyles.P90.color} strokeDasharray={percentileStyles.P90.dash} strokeWidth={1} dot={false} name="90th" connectNulls />
                            <Line data={heightPercentiles} type="natural" dataKey="P97" stroke={percentileStyles.P97.color} strokeDasharray={percentileStyles.P97.dash} strokeWidth={1} dot={false} name="97th" connectNulls />
                          </>
                        )}
                        {/* Patient's actual height */}
                        <Line 
                          data={heightPatientData.filter(d => d.height)}
                          type="natural" 
                          dataKey="height" 
                          stroke="#10B981" 
                          strokeWidth={3}
                          dot={{ r: 4, fill: '#10B981' }}
                          activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }}
                          name="Patient Height"
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap justify-center gap-3 mt-2 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-slate-800"></span> 50th</span>
                    <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-slate-500 border-dashed"></span> Percentiles</span>
                    <span className="flex items-center gap-1"><span className="w-4 h-1 bg-emerald-500 rounded"></span> Patient</span>
                  </div>
                </div>
              </div>
              <div className="mt-6 bg-white rounded-lg shadow-sm p-4">
                <h4 className="text-lg font-semibold text-gray-700 mb-2">BMI Over Time</h4>
                {bmiTrendData.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    BMI cannot be calculated yet because some visits are missing height or weight measurements.
                  </p>
                ) : (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="ageInDays"
                          type="number"
                          domain={['dataMin', 'dataMax']}
                          tickFormatter={formatAgeCompact}
                          allowDuplicatedCategory={false}
                        />
                        <YAxis
                          domain={['auto', 'auto']}
                          tickFormatter={(value) => (value == null ? '' : value.toFixed(0))}
                          width={50}
                        />
                        <Tooltip
                          formatter={(value, name) => [`${Number(value).toFixed(1)}`, name]}
                          labelFormatter={(value) => `Age: ${formatAge(value)}`}
                        />
                        {/* CDC BMI Percentile curves */}
                        {bmiPercentiles && (
                          <>
                            <Line data={bmiPercentiles} type="natural" dataKey="P3" stroke={percentileStyles.P3.color} strokeDasharray={percentileStyles.P3.dash} strokeWidth={1} dot={false} name="3rd" connectNulls />
                            <Line data={bmiPercentiles} type="natural" dataKey="P10" stroke={percentileStyles.P10.color} strokeDasharray={percentileStyles.P10.dash} strokeWidth={1} dot={false} name="10th" connectNulls />
                            <Line data={bmiPercentiles} type="natural" dataKey="P25" stroke={percentileStyles.P25.color} strokeDasharray={percentileStyles.P25.dash} strokeWidth={1} dot={false} name="25th" connectNulls />
                            <Line data={bmiPercentiles} type="natural" dataKey="P50" stroke={percentileStyles.P50.color} strokeWidth={2} dot={false} name="50th (median)" connectNulls />
                            <Line data={bmiPercentiles} type="natural" dataKey="P75" stroke={percentileStyles.P75.color} strokeDasharray={percentileStyles.P75.dash} strokeWidth={1} dot={false} name="75th" connectNulls />
                            <Line data={bmiPercentiles} type="natural" dataKey="P90" stroke={percentileStyles.P90.color} strokeDasharray={percentileStyles.P90.dash} strokeWidth={1} dot={false} name="90th" connectNulls />
                            <Line data={bmiPercentiles} type="natural" dataKey="P97" stroke={percentileStyles.P97.color} strokeDasharray={percentileStyles.P97.dash} strokeWidth={1} dot={false} name="97th" connectNulls />
                          </>
                        )}
                        {/* Patient's actual BMI */}
                        <Line
                          data={bmiTrendData}
                          type="natural"
                          dataKey="bmi"
                          stroke="#F97316"
                          strokeWidth={3}
                          dot={{ r: 4, fill: '#F97316' }}
                          activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }}
                          name="Patient BMI"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="flex flex-wrap justify-center gap-3 mt-2 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-slate-800"></span> 50th</span>
                  <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-slate-500 border-dashed"></span> Percentiles</span>
                  <span className="flex items-center gap-1"><span className="w-4 h-1 bg-orange-500 rounded"></span> Patient</span>
              </div>
            </div>
            </div>
          );
          })()}

          {activeSection === 'medications' && (
            <div>
              <h3 className="text-xl font-bold text-gray-800 mb-4">Medications History</h3>
              
              {/* Most Used Medications - at the top */}
              <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
                <h4 className="text-lg font-semibold text-gray-700 mb-3">Most Used Medications</h4>
                {medicationInsights.topMedications.length === 0 ? (
                  <p className="text-sm text-gray-500">No medications recorded.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {medicationInsights.topMedications.map((med) => (
                      <div 
                        key={med.name} 
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-lg text-sm whitespace-nowrap"
                      >
                        <span className="font-medium text-gray-700">
                              {med.name}
                                </span>
                        <span className="px-1.5 py-0.5 bg-emerald-600 text-white text-xs font-semibold rounded">
                          {med.count}
                                </span>
                    </div>
                  ))}
                </div>
                    )}
                  </div>

              {/* Medication Activity Timeline - moved to top */}
                {medicationInsights.timeline.length > 0 && (
                <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
                      <div>
                        <h4 className="text-lg font-semibold text-gray-700">Medication Activity Timeline</h4>
                      <p className="text-xs text-gray-400 italic">The same medication may appear multiple times.</p>
                                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="text-xs text-gray-500">
                          {formatAge(medicationInsights.timelineRange.start)} → {formatAge(medicationInsights.timelineRange.end)}
                                    </div>
                        <label className="flex items-center text-xs text-gray-500">
                          <span className="mr-2">Sort by</span>
                          <select
                            className="border rounded px-2 py-1 text-xs bg-white"
                            value={medicationTimelineSort}
                            onChange={(e) => setMedicationTimelineSort(e.target.value)}
                          >
                          <option value="last">Most Recent</option>
                          <option value="start">Oldest First</option>
                          </select>
                        </label>
                                  </div>
                                  </div>
                  <div className="relative">
                    <div 
                      className="space-y-4 max-h-[800px] overflow-y-auto"
                      onScroll={(e) => handleScroll(e, 'medicationTimeline')}
                      ref={(el) => checkInitialScrollState(el, 'medicationTimeline')}
                    >
                      {sortedMedicationTimeline.map((entry, idx) => {
                        const span = medicationInsights.timelineRange.span || 1;
                        const rawStartPercentage = span ? ((entry.firstStart - medicationInsights.timelineRange.start) / span) * 100 : 0;
                        const minWidth = 3;
                        const startPercentage = Math.max(0, Math.min(100 - minWidth, rawStartPercentage));
                        const widthPercentage = Math.max(minWidth, Math.min(100 - startPercentage, ((entry.duration || 1) / span) * 100));
                        return (
                          <div key={entry.prescriptionId || `${entry.name}-${idx}`}>
                            <div className="flex justify-between text-sm font-medium text-gray-700">
                              <div>
                                <p>{entry.name}</p>
                                <p className="text-xs text-gray-500">{entry.type} • {entry.occurrences} order{entry.occurrences > 1 ? 's' : ''}</p>
                                </div>
                              <div className="text-xs text-gray-500 text-right">
                                <p>Start: {formatAge(entry.firstStart)}</p>
                                <p>End: {formatAge(entry.lastEnd)}</p>
                                <p>Duration: {entry.duration} days [{Math.floor(entry.duration / 365)}y {Math.floor((entry.duration % 365) / 30)}m]</p>
                              </div>
                            </div>
                            <div className="relative mt-2 h-3 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="absolute top-0 h-full bg-amber-500 rounded-full"
                                style={{
                                  left: `${startPercentage}%`,
                                  width: `${widthPercentage}%`
                                }}
                              ></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {!scrolledToBottom.medicationTimeline && (
                      <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
                    )}
                  </div>
                </div>
          )}

              <div className="bg-white rounded-lg shadow-lg p-6">
                {/* Medications Table */}
                <div className="mt-6">
                  <div className="flex justify-between items-center mb-4">
            <div>
                      <h4 className="text-lg font-semibold text-gray-700">Medication Details</h4>
                      <p className="text-xs text-gray-400 italic">The same medication may appear multiple times.</p>
                    </div>
                    <label className="flex items-center text-xs text-gray-500">
                      <span className="mr-2">Sort by</span>
                      <select 
                        className="border rounded px-2 py-1 text-xs bg-white"
                        value={medicationTimelineSort}
                        onChange={(e) => setMedicationTimelineSort(e.target.value)}
                      >
                        <option value="last">Most Recent</option>
                        <option value="start">Oldest First</option>
                      </select>
                      </label>
                    </div>
                  <div className="relative">
                    <div 
                      className="overflow-auto max-h-[600px]"
                      onScroll={(e) => handleScroll(e, 'medicationTable')}
                      ref={(el) => checkInitialScrollState(el, 'medicationTable')}
                    >
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Medication</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Start</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">End/Status</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                          {prepareMedicationsForGantt(filteredVisits)
                            .sort((a, b) => medicationTimelineSort === 'last' ? b.start - a.start : a.start - b.start)
                          .map((med, idx) => (
                            <tr 
                              key={idx}
                              className="hover:bg-gray-50 transition-colors"
                            >
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                {med.name}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {formatAge(med.start)}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className={`px-2 py-1 rounded-full text-xs font-medium
                                  ${med.end === 'ongoing' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}
                                `}>
                                  {med.end === 'ongoing' ? 'Ongoing' : formatAge(med.end)}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {med.end === 'ongoing' ? 'Ongoing' : `${Math.round(med.end - med.start)} days [${Math.floor((med.end - med.start) / 365)}y ${Math.floor(((med.end - med.start) % 365) / 30)}m]`}
                              </td>
                            </tr>
                          ))
                        }
                      </tbody>
                    </table>
                  </div>
                    {/* Gradient fade - hidden when scrolled to bottom */}
                    {!scrolledToBottom.medicationTable && (
                      <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
                    )}
                  </div>
                      </div>
              </div>
            </div>
          )}

          {activeSection === 'labs' && (
            <div>
              <h3 className="text-xl font-bold text-gray-800 mb-4">Lab Results</h3>
              
              {renderLabsTimeline()}

              {/* Lab Result Trends Chart - Multi-select */}
              <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
                <div className="flex flex-col md:flex-row md:justify-between md:items-start mb-4 gap-4">
                    <div>
                    <h4 className="text-lg font-semibold text-gray-700">Lab Result Trends</h4>
                    <p className="text-xs text-gray-400">Select lab components to compare trends over time</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <select 
                        className="block w-64 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value && value !== 'all' && !selectedLabComponents.includes(value)) {
                            setSelectedLabComponents([...selectedLabComponents, value]);
                          }
                          e.target.value = 'all';
                        }}
                        defaultValue="all"
                      >
                        <option value="all">+ Add Lab Component</option>
                        {labTrendSeries
                          .filter(s => !selectedLabComponents.includes(s.componentName))
                          .sort((a, b) => a.componentName.localeCompare(b.componentName))
                          .map(series => (
                            <option key={series.componentName} value={series.componentName}>
                              {series.componentName} ({series.testCategory})
                            </option>
                          ))
                        }
                      </select>
                      {selectedLabComponents.length > 0 && (
                        <button
                          onClick={() => setSelectedLabComponents([])}
                          className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-md"
                        >
                          Clear All
                        </button>
                      )}
                    </div>
                    {selectedLabComponents.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {selectedLabComponents.map(comp => (
                          <span 
                            key={comp}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-100 text-indigo-800 text-xs rounded-full"
                          >
                            {comp}
                            <button
                              onClick={() => setSelectedLabComponents(selectedLabComponents.filter(c => c !== comp))}
                              className="hover:text-indigo-600"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                    </div>
                    )}
                  </div>
                    </div>
                
                {selectedLabComponents.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-sm text-gray-500 bg-gray-50 rounded-lg">
                    {labTrendSeries.length === 0 
                      ? 'No numeric lab results available.' 
                      : 'Select lab components from the dropdown above to view their trends.'}
                  </div>
                ) : (
                  <div className="space-y-6">
                    {selectedLabComponents.map((componentName, chartIndex) => {
                      const series = labTrendSeries.find(s => s.componentName === componentName);
                      if (!series) return null;
                      
                      return (
                        <div key={componentName} className="border border-gray-200 rounded-lg p-4">
                          <div className="flex justify-between items-center mb-2">
                            <h5 className="text-sm font-semibold text-gray-700">{componentName}</h5>
                            <span className="text-xs text-gray-500">{series.testCategory}</span>
                          </div>
                          <div className="h-48">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart 
                                data={series.data}
                                margin={{ top: 10, right: 30, bottom: 20, left: 40 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis 
                                  dataKey="ageInDays"
                                  tickFormatter={(days) => formatAge(days)}
                                  tick={{ fontSize: 11 }}
                                />
                                <YAxis 
                                  domain={['auto', 'auto']}
                                  tick={{ fontSize: 11 }}
                                />
                                <Tooltip 
                                  contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.95)', borderRadius: '8px', border: '1px solid #E5E7EB' }}
                                  labelFormatter={(days) => `Age: ${formatAge(days)}`}
                                  formatter={(value, name, props) => [
                                    `${value} ${props.payload.result ? `(${props.payload.result})` : ''}`,
                                    componentName
                                  ]}
                                />
                                <Line 
                                  type="monotone"
                                  dataKey="value"
                                  name={componentName}
                                  stroke={`hsl(${chartIndex * 60 + 220}, 70%, 50%)`}
                                  strokeWidth={2}
                                  dot={(props) => {
                                    const { cx, cy, payload } = props;
                                    const flag = payload.flag;
                                    let fill = '#34D399';
                                    if (flag === 'H') fill = '#FCD34D';
                                    if (flag === 'L') fill = '#F87171';
                                    return (
                                      <circle 
                                        cx={cx} 
                                        cy={cy} 
                                        r={5} 
                                        fill={fill} 
                                        stroke="#fff" 
                                        strokeWidth={2}
                                      />
                                    );
                                  }}
                                  activeDot={{ r: 7 }}
                                />
                              </LineChart>
                            </ResponsiveContainer>
                    </div>
                  </div>
                      );
                    })}
                </div>
                )}
              </div>

              {/* Lab Results Table */}
              <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
                <div className="mb-4">
                  <h4 className="text-lg font-semibold text-gray-700">Lab Results Table</h4>
                  </div>
                <div className="relative">
                  <div 
                    className="overflow-auto max-h-[600px]"
                    onScroll={(e) => handleScroll(e, 'labsTable')}
                    ref={(el) => checkInitialScrollState(el, 'labsTable')}
                  >
                  <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50 sticky top-0 z-10">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Test Name</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Result</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reference Range</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Age at Test</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredLabResults.length === 0 ? (
                        <tr>
                          <td className="px-6 py-4 text-sm text-gray-500" colSpan={5}>
                            No lab results match the current filters.
                          </td>
                        </tr>
                      ) : (
                        filteredLabResults.map((lab, index) => (
                          <tr
                            key={lab.uniqueKey || index}
                            className="hover:bg-gray-50 cursor-pointer transition-colors bg-white"
                            onClick={() => {
                              setSelectedLab(lab);
                              setModalContent({
                                title: `Lab Result Details - ${lab.testName}`,
                                content: (
                                  <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                      <div>
                                        <p className="text-sm text-gray-500">Test Category</p>
                                        <p className="font-medium">{lab.testCategory}</p>
                                      </div>
                                      <div>
                                        <p className="text-sm text-gray-500">Component</p>
                                        <p className="font-medium">{lab.component}</p>
                                      </div>
                                      <div>
                                        <p className="text-sm text-gray-500">Result</p>
                                        <p className="font-medium">{lab.result}</p>
                                      </div>
                                      <div>
                                        <p className="text-sm text-gray-500">Age at Test</p>
                                        <p className="font-medium">{formatAge(lab.ageInDays)}</p>
                                      </div>
                                    </div>
                                  </div>
                                )
                              });
                              setIsModalOpen(true);
                            }}
                          >
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-gray-900">{lab.testName}</div>
                              <div className="text-xs text-gray-500">{lab.component}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {lab.testCategory}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {lab.result}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {showReferenceRanges ? '10-20' : '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {formatAge(lab.ageInDays)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                  {!scrolledToBottom.labsTable && (
                    <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
                  )}
              </div>
              </div>
            </div>
          )}

          {activeSection === 'problems' && (
            <div>
              <h3 className="text-xl font-bold text-gray-800 mb-4">Problem List & Resolution Status</h3>
              
              {/* Problem Activity Timeline */}
              {prepareProblemResolutionData(filteredVisits).length > 0 && (() => {
                const problemData = prepareProblemResolutionData(filteredVisits);
                const allFirstSeen = problemData.map(p => p.firstSeen * 365);
                const allLastSeen = problemData.map(p => p.lastSeen * 365);
                const timelineStart = Math.min(...allFirstSeen);
                const timelineEnd = Math.max(...allLastSeen);
                const timelineSpan = timelineEnd - timelineStart || 1;
                
                const sortedProblems = [...problemData].sort((a, b) => {
                  if (problemTimelineSort === 'first') {
                    return (a.firstSeen * 365) - (b.firstSeen * 365);
                  }
                  return (b.lastSeen * 365) - (a.lastSeen * 365);
                });
                
                return (
                  <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
                      <div>
                        <h4 className="text-lg font-semibold text-gray-700">Problem Activity Timeline</h4>
                        <p className="text-xs text-gray-400 italic">Shows when each problem was first and last seen.</p>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex items-center gap-3 text-xs">
                          <span className="flex items-center">
                            <span className="w-3 h-3 rounded-full bg-yellow-500 mr-1"></span>
                            Active
                          </span>
                          <span className="flex items-center">
                            <span className="w-3 h-3 rounded-full bg-green-500 mr-1"></span>
                            Resolved
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          {formatAge(timelineStart)} → {formatAge(timelineEnd)}
                        </div>
                        <label className="flex items-center text-xs text-gray-500">
                          <span className="mr-2">Sort by</span>
                    <select 
                            className="border rounded px-2 py-1 text-xs bg-white"
                            value={problemTimelineSort}
                            onChange={(e) => setProblemTimelineSort(e.target.value)}
                          >
                            <option value="last">Most Recent</option>
                            <option value="first">Oldest First</option>
                    </select>
                        </label>
                  </div>
                </div>
                    <div className="relative">
                      <div 
                        className="space-y-4 max-h-[800px] overflow-y-auto"
                        onScroll={(e) => handleScroll(e, 'problemTimeline')}
                        ref={(el) => checkInitialScrollState(el, 'problemTimeline')}
                      >
                        {sortedProblems.map((problem, idx) => {
                          const startDays = problem.firstSeen * 365;
                          const endDays = problem.lastSeen * 365;
                          const durationDays = endDays - startDays;
                          
                      return (
                            <div key={`${problem.code}-${idx}`}>
                              <div className="flex justify-between text-sm font-medium text-gray-700">
                                <div>
                                  <p>{problem.problem}</p>
                                  <p className="text-xs text-gray-500">{problem.occurrences} occurrence{problem.occurrences > 1 ? 's' : ''}</p>
                        </div>
                                <div className="text-xs text-gray-500 text-right">
                                  <p>First: {formatAge(startDays)}</p>
                                  <p>Last: {formatAge(endDays)}</p>
                                  <p>Span: {Math.round(durationDays)} days [{Math.floor(durationDays / 365)}y {Math.floor((durationDays % 365) / 30)}m]</p>
                                </div>
                              </div>
                              <div className="relative mt-2 h-6 bg-gray-100 rounded-full">
                                {/* Show individual dots for each occurrence */}
                                {problem.occurrenceDates && problem.occurrenceDates.map((ageInDays, dotIdx) => {
                                  const leftPercent = ((ageInDays - timelineStart) / timelineSpan) * 100;
                    return (
                                    <div
                                      key={`${problem.code}-dot-${dotIdx}`}
                                      className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-white shadow-sm ${problem.resolved ? 'bg-green-500' : 'bg-yellow-500'}`}
                                      style={{ left: `${Math.max(2, Math.min(98, leftPercent))}%` }}
                                      title={`Diagnosed at ${formatAge(ageInDays)}`}
                                    ></div>
                                  );
                                })}
                </div>
              </div>
                          );
                        })}
            </div>
                      {!scrolledToBottom.problemTimeline && (
                        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
          )}
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 gap-6">
                {/* Problem List Table */}
                <div className="bg-white rounded-lg shadow-lg p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h4 className="text-lg font-semibold text-gray-700">All Problems</h4>
                    <div className="flex items-center space-x-4">
                    <div className="flex space-x-2">
                      <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm">Active</span>
                      <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">Resolved</span>
                    </div>
                      <label className="flex items-center text-xs text-gray-500">
                        <span className="mr-2">Sort by</span>
                        <select
                          className="border rounded px-2 py-1 text-xs bg-white"
                          value={problemTimelineSort}
                          onChange={(e) => setProblemTimelineSort(e.target.value)}
                        >
                          <option value="last">Most Recent</option>
                          <option value="first">Oldest First</option>
                        </select>
                      </label>
                  </div>
                  </div>
                  <div className="relative">
                    <div 
                      className="overflow-auto max-h-[600px]"
                      onScroll={(e) => handleScroll(e, 'problemsTable')}
                      ref={(el) => checkInitialScrollState(el, 'problemsTable')}
                    >
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Problem</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">First Seen</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Seen</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                          {prepareProblemResolutionData(filteredVisits)
                          .sort((a, b) => {
                            // Sort by the selected sort option
                            if (problemTimelineSort === 'first') {
                              return (a.firstSeen * 365) - (b.firstSeen * 365);
                            }
                            return (b.lastSeen * 365) - (a.lastSeen * 365);
                          })
                          .map((problem, index) => (
                            <tr key={index} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                {problem.problem}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                                {problem.code}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {formatAge(problem.firstSeen * 365)}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {formatAge(problem.lastSeen * 365)}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {Math.round(problem.duration * 365)} days [{Math.floor(problem.duration)}y {Math.floor((problem.duration % 1) * 12)}m]
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className={`px-2 py-1 text-xs rounded-full font-medium
                                  ${problem.resolved ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}
                                `}>
                                  {problem.resolved ? 'Resolved' : 'Active'}
                                </span>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    </div>
                    {!scrolledToBottom.problemsTable && (
                      <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'referrals' && (
            <div>
              <h3 className="text-xl font-bold text-gray-800 mb-4">Referrals History</h3>
              <div className="grid grid-cols-1 gap-6">
                {/* Referrals Table */}
                <div className="bg-white rounded-lg shadow-lg p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h4 className="text-lg font-semibold text-gray-700">All Referrals</h4>
                  </div>
                  {(() => {
                    // Get all visits for this patient and extract referrals
                    const referralsData = filteredVisits
                      .map(visit => ({
                        date: visit.date,
                        ageInDays: visit.ageInDays,
                        referrals: visit.referrals_details ? visit.referrals_details.split(';').map(ref => ref.trim()).filter(ref => ref) : []
                      }))
                      .filter(visit => visit.referrals.length > 0)
                      .flatMap(visit => {
                        return visit.referrals.map(ref => {
                          // Parse the referral details
                          const specialty = ref.split(' (')[0];
                          const details = ref.match(/\((.*?)\)/g) || [];
                          const dateMatch = details[0]?.match(/date: (.*?),/);
                          const visitsMatch = details[0]?.match(/visits: (.*?)\)/);
                          
                          return {
                            date: visit.date,
                            ageInDays: visit.ageInDays,
                            details: ref,
                            specialty: specialty,
                            referralDate: dateMatch ? dateMatch[1] : 'unknown',
                            numberOfVisits: visitsMatch ? visitsMatch[1] : 'unknown',
                            problems: visit.diagnoses ? visit.diagnoses.map(code => lookupICDCode(code)?.description || diagnosisMap[code] || `${code} (Unmapped)`) : []
                          };
                        });
                      })
                      .sort((a, b) => b.ageInDays - a.ageInDays);

                    if (referralsData.length === 0) {
                      return (
                        <div className="text-center py-8">
                          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                            <UserGroupIcon className="w-8 h-8 text-gray-400" />
                          </div>
                          <h3 className="text-lg font-medium text-gray-900 mb-2">No Referrals Found</h3>
                          <p className="text-gray-500">This patient has no recorded referrals in their medical history.</p>
                        </div>
                      );
                    }

                    return (
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Specialty</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Referral Date</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Number of Visits</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Age at Referral</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Related Problems</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {referralsData.map((referral, index) => (
                              <tr key={index} className="hover:bg-gray-50">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                  {referral.specialty}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {referral.referralDate === 'unknown' ? 'Unknown' : formatAge(parseInt(referral.referralDate))}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {referral.numberOfVisits === 'unknown' ? 'Unknown' : referral.numberOfVisits}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {formatAge(referral.ageInDays)}
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-500">
                                  {referral.problems.join(', ')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>

                {/* Referrals Summary */}
                <div className="bg-white rounded-lg shadow-lg p-6">
                  <h4 className="text-lg font-semibold text-gray-700 mb-4">Referrals by Specialty</h4>
                  {(() => {
                    const specialtyCounts = selectedPatient.visits
                      .flatMap(visit => 
                        visit.referrals_details ? 
                          visit.referrals_details.split(';')
                            .map(ref => ref.trim())
                            .filter(ref => ref)
                            .map(ref => ({
                              specialty: ref.split(' (')[0],
                              visits: ref.match(/visits: (.*?)\)/)?.[1] || '0'
                            })) : 
                          []
                      )
                      .reduce((acc, curr) => {
                        if (!acc[curr.specialty]) {
                          acc[curr.specialty] = {
                            count: 0,
                            totalVisits: 0
                          };
                        }
                        acc[curr.specialty].count += 1;
                        acc[curr.specialty].totalVisits += parseInt(curr.visits) || 0;
                        return acc;
                      }, {});

                    if (Object.keys(specialtyCounts).length === 0) {
                      return (
                        <div className="text-center py-4">
                          <p className="text-gray-500">No specialty referrals to summarize.</p>
                        </div>
                      );
                    }

                    return (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {Object.entries(specialtyCounts).map(([specialty, data]) => (
                          <div key={specialty} className="bg-gray-50 rounded-lg p-4">
                            <h5 className="font-medium text-gray-900">{specialty}</h5>
                            <div className="mt-2">
                              <p className="text-2xl font-bold text-indigo-600">{data.count}</p>
                              <p className="text-sm text-gray-500">referrals</p>
                            </div>
                            <div className="mt-2">
                              <p className="text-lg font-semibold text-green-600">{data.totalVisits}</p>
                              <p className="text-sm text-gray-500">total visits</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {activeSection === 'integratedTimeline' && renderIntegratedTimeline()}
                    </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={modalContent.title}
      >
        {modalContent.content}
      </Modal>

      {/* LLM Modal */}
      {isLLMModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-start justify-center pt-20">
          <div className="bg-white w-full max-w-2xl rounded-xl shadow-xl overflow-hidden">
            <div className="bg-[#6366F1] px-6 py-4 flex justify-between items-center">
              <div className="flex items-center">
                <svg className="w-6 h-6 text-white mr-3" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 1L15.5 8.5L23 9.5L17.5 15L19 22.5L12 19L5 22.5L6.5 15L1 9.5L8.5 8.5L12 1Z" fill="currentColor"/>
                </svg>
                <span className="text-white text-lg font-medium">Patient Visit Summary</span>
              </div>
              <button 
                onClick={() => setIsLLMModalOpen(false)}
                className="text-white hover:text-gray-200"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-[#F3F4F6] p-6 min-h-[400px] flex flex-col">
              {isGenerating ? (
                <div className="flex items-center justify-center h-full">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#6366F1]"></div>
                </div>
              ) : (
                <>
                  {chatMessages.map((message, index) => (
                    <div key={index} className="bg-white rounded-lg p-4 mb-4 shadow-sm">
                      <p className="text-gray-700 whitespace-pre-wrap">{message.content}</p>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Removed global Visit Summary rendering */}
        </div>
      {renderPhysicianSummaryPanel()}
      <ICDTooltipPortal />
    </>
  );
};

const formatAgeCompact = (days) => {
  if (!Number.isFinite(days)) return '–';
  const years = Math.floor(days / 365);
  const months = Math.round((days % 365) / 30);
  if (years > 0) {
    return `${years}y${months ? ` ${months}m` : ''}`;
  }
  const weeks = Math.floor(days / 7);
  if (weeks > 0) {
    return `${weeks}w`;
  }
  return `${Math.max(0, Math.round(days))}d`;
};

const formatAge = (days) => {
  if (!Number.isFinite(days)) return '–';
  const years = Math.floor(days / 365);
  const remainingDays = days % 365;
  const months = Math.floor(remainingDays / 30);
  
  if (years > 0) {
    return months > 0 ? `${years}y ${months}m` : `${years}y`;
  }
  if (months > 0) {
    return `${months}m`;
  }
  const weeks = Math.floor(days / 7);
  if (weeks > 0) {
    return `${weeks}w`;
  }
  return `${Math.max(0, Math.round(days))}d`;
};

export default PatientDataProcessor; 

