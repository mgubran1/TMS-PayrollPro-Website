'use client'

import React, { useState, useEffect } from 'react'
import { Plus, Search, Download, Upload, Edit, Trash2, Building2, Phone, Mail, MapPin } from 'lucide-react'
import { useUser } from '@clerk/nextjs'
import { AddressBookEntry, AddressBookHelpers } from '../../lib/types'

const ADDRESS_TYPES = [
  { value: 'CUSTOMER', label: 'Customer', color: 'bg-blue-100 text-blue-800' },
  { value: 'BROKER', label: 'Broker', color: 'bg-green-100 text-green-800' },
  { value: 'SHIPPER', label: 'Shipper', color: 'bg-purple-100 text-purple-800' },
  { value: 'CONSIGNEE', label: 'Consignee', color: 'bg-orange-100 text-orange-800' },
  { value: 'VENDOR', label: 'Vendor', color: 'bg-gray-100 text-gray-800' }
]

const EMPTY_ENTRY: Partial<AddressBookEntry> = {
  name: '',
  type: 'CUSTOMER',
  address: '',
  city: '',
  state: '',
  zipCode: '',
  country: 'USA',
  contactPerson: '',
  phone: '',
  email: '',
  fax: '',
  website: '',
  notes: '',
  taxId: '',
  mcNumber: '',
  dotNumber: '',
  creditLimit: 0,
  paymentTerms: '',
  preferredRate: 0,
  isActive: true
}

export default function AddressBookPage() {
  const { isSignedIn, user, isLoaded } = useUser()
  const [entries, setEntries] = useState<AddressBookEntry[]>([])
  const [filteredEntries, setFilteredEntries] = useState<AddressBookEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedType, setSelectedType] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [editingEntry, setEditingEntry] = useState<AddressBookEntry | null>(null)
  const [formData, setFormData] = useState<Partial<AddressBookEntry>>(EMPTY_ENTRY)
  const [saving, setSaving] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [pagination, setPagination] = useState({
    limit: 100,
    offset: 0,
    total: 0,
    hasMore: false
  })
  const [currentPage, setCurrentPage] = useState(1)

  // Fetch entries with pagination
  const fetchEntries = async (page = 1, limit = 100) => {
    setLoading(true)
    try {
      const offset = (page - 1) * limit
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
        search: searchTerm,
        type: selectedType
      })
      
      const response = await fetch(`/api/address-book?${params}`)
      if (response.ok) {
        const data = await response.json()
        setEntries(data.entries || [])
        setFilteredEntries(data.entries || [])
        setPagination({
          limit,
          offset,
          total: data.pagination?.total || 0,
          hasMore: data.pagination?.hasMore || false
        })
        setCurrentPage(page)
      } else {
        throw new Error('Failed to fetch address book')
      }
    } catch (error) {
      console.error('Error fetching address book:', error)
      setError(error instanceof Error ? error.message : 'Failed to fetch address book')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEntries(1, pagination.limit)
  }, [])

  // Fetch when search or filter changes
  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      fetchEntries(1, pagination.limit)
    }, 500)
    
    return () => clearTimeout(debounceTimer)
  }, [searchTerm, selectedType])

  // Filter entries (now handled by API with server-side filtering)
  useEffect(() => {
    setFilteredEntries(entries.filter(entry => entry.isActive))
  }, [entries])

  const handleSave = async () => {
    if (!formData.name || !formData.type) {
      alert('Name and type are required')
      return
    }

    setSaving(true)
    try {
      const url = editingEntry ? '/api/address-book' : '/api/address-book'
      const method = editingEntry ? 'PUT' : 'POST'
      const body = editingEntry ? { ...formData, id: editingEntry.id } : formData

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (response.ok) {
        await fetchEntries()
        setShowForm(false)
        setEditingEntry(null)
        setFormData(EMPTY_ENTRY)
      } else {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to save entry')
      }
    } catch (error) {
      console.error('Error saving entry:', error)
      alert(error instanceof Error ? error.message : 'Failed to save entry')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this entry?')) return

    try {
      const response = await fetch(`/api/address-book?id=${id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        await fetchEntries()
      } else {
        throw new Error('Failed to delete entry')
      }
    } catch (error) {
      console.error('Error deleting entry:', error)
      alert('Failed to delete entry')
    }
  }

  const handleExport = () => {
    const csvContent = [
      'Company,Type,Address,City,State,ZipCode,Country,ContactPerson,Phone,Email,Fax,Website,TaxId,MCNumber,DOTNumber,CreditLimit,PaymentTerms,PreferredRate,Notes',
      ...filteredEntries.map(entry => [
        entry.name,
        entry.type,
        entry.address || '',
        entry.city || '',
        entry.state || '',
        entry.zipCode || '',
        entry.country,
        entry.contactPerson || '',
        entry.phone || '',
        entry.email || '',
        entry.fax || '',
        entry.website || '',
        entry.taxId || '',
        entry.mcNumber || '',
        entry.dotNumber || '',
        entry.creditLimit,
        entry.paymentTerms || '',
        entry.preferredRate,
        entry.notes || ''
      ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `address-book-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  const handleImport = async () => {
    if (!importFile) {
      alert('Please select a CSV file to import')
      return
    }

    setImporting(true)
    try {
      const text = await importFile.text()
      const lines = text.split('\n').filter(line => line.trim())
      
      if (lines.length < 2) {
        throw new Error('CSV file must have a header row and at least one data row')
      }

      const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim())
      const companyIndex = headers.findIndex(h => h.toLowerCase().includes('company') || h.toLowerCase().includes('name'))
      const typeIndex = headers.findIndex(h => h.toLowerCase().includes('type'))
      
      if (companyIndex === -1 || typeIndex === -1) {
        throw new Error('CSV must include Company and Type columns')
      }

      const importedEntries = []
      const errors = []

      for (let i = 1; i < lines.length; i++) {
        try {
          const values = lines[i].split(',').map(v => v.replace(/"/g, '').trim())
          
          if (values.length < 2) continue

          const entry = {
            name: values[companyIndex] || '',
            type: values[typeIndex] || 'CUSTOMER',
            address: values[headers.findIndex(h => h.toLowerCase().includes('address'))] || '',
            city: values[headers.findIndex(h => h.toLowerCase().includes('city'))] || '',
            state: values[headers.findIndex(h => h.toLowerCase().includes('state'))] || '',
            zipCode: values[headers.findIndex(h => h.toLowerCase().includes('zip'))] || '',
            country: values[headers.findIndex(h => h.toLowerCase().includes('country'))] || 'USA',
            contactPerson: values[headers.findIndex(h => h.toLowerCase().includes('contact'))] || '',
            phone: values[headers.findIndex(h => h.toLowerCase().includes('phone'))] || '',
            email: values[headers.findIndex(h => h.toLowerCase().includes('email'))] || '',
            fax: values[headers.findIndex(h => h.toLowerCase().includes('fax'))] || '',
            website: values[headers.findIndex(h => h.toLowerCase().includes('website'))] || '',
            taxId: values[headers.findIndex(h => h.toLowerCase().includes('tax'))] || '',
            mcNumber: values[headers.findIndex(h => h.toLowerCase().includes('mc'))] || '',
            dotNumber: values[headers.findIndex(h => h.toLowerCase().includes('dot'))] || '',
            creditLimit: parseFloat(values[headers.findIndex(h => h.toLowerCase().includes('credit'))] || '0') || 0,
            paymentTerms: values[headers.findIndex(h => h.toLowerCase().includes('payment'))] || '',
            preferredRate: parseFloat(values[headers.findIndex(h => h.toLowerCase().includes('rate'))] || '0') || 0,
            notes: values[headers.findIndex(h => h.toLowerCase().includes('note'))] || '',
            isActive: true
          }

          if (!entry.name) {
            errors.push(`Row ${i + 1}: Company name is required`)
            continue
          }

          const validTypes = ['CUSTOMER', 'BROKER', 'SHIPPER', 'CONSIGNEE', 'VENDOR']
          if (!validTypes.includes(entry.type.toUpperCase())) {
            entry.type = 'CUSTOMER'
          } else {
            entry.type = entry.type.toUpperCase()
          }

          importedEntries.push(entry)
        } catch (error) {
          errors.push(`Row ${i + 1}: ${error instanceof Error ? error.message : 'Invalid data format'}`)
        }
      }

      if (importedEntries.length === 0) {
        throw new Error('No valid entries found in CSV file')
      }

      let successCount = 0
      let duplicateCount = 0

      for (const entry of importedEntries) {
        try {
          const response = await fetch('/api/address-book', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry)
          })

          if (response.ok) {
            successCount++
          } else if (response.status === 409) {
            duplicateCount++
          } else {
            const errorData = await response.json()
            errors.push(`${entry.name}: ${errorData.error || 'Failed to import'}`)
          }
        } catch (error) {
          errors.push(`${entry.name}: ${error instanceof Error ? error.message : 'Network error'}`)
        }
      }

      let message = `Import completed!\n\n`
      message += `✅ Successfully imported: ${successCount} entries\n`
      if (duplicateCount > 0) message += `⚠️  Duplicates skipped: ${duplicateCount} entries\n`
      if (errors.length > 0) message += `❌ Errors: ${errors.length} entries\n\n`
      if (errors.length > 0) {
        message += `Errors:\n${errors.slice(0, 10).join('\n')}`
        if (errors.length > 10) message += `\n... and ${errors.length - 10} more`
      }

      alert(message)
      
      if (successCount > 0) {
        await fetchEntries()
      }

      setShowImport(false)
      setImportFile(null)

    } catch (error) {
      console.error('Import error:', error)
      alert(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setImporting(false)
    }
  }

  if (!isLoaded || !isSignedIn) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 text-center">
        <h1 className="text-2xl font-semibold mb-3">Please sign in to view Address Book</h1>
        <a className="btn" href="/sign-in">Sign in</a>
      </main>
    )
  }

  const role = (user.publicMetadata?.role as string) || 'viewer'
  const canEdit = role === 'admin' || role === 'manager'

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Address Book</h1>
              <p className="mt-2 text-slate-600">Manage customers, brokers, shippers, and vendors</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleExport}
                className="btn-secondary flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
              {canEdit && (
                <>
                  <button
                    onClick={() => setShowImport(true)}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Import CSV
                  </button>
                  <button
                    onClick={() => {
                      setEditingEntry(null)
                      setFormData(EMPTY_ENTRY)
                      setShowForm(true)
                    }}
                    className="btn flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Entry
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by name, contact, city, phone, email..."
                  className="input pl-10"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Type</label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="input"
              >
                <option value="all">All Types</option>
                {ADDRESS_TYPES.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="text-2xl font-bold text-slate-900">{pagination.total.toLocaleString()}</div>
            <div className="text-sm text-slate-600">Total Active</div>
          </div>
          {ADDRESS_TYPES.map(type => {
            const count = entries.filter(e => e.type === type.value && e.isActive).length
            return (
              <div key={type.value} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <div className="text-2xl font-bold text-slate-900">{count}</div>
                <div className="text-sm text-slate-600">{type.label}s</div>
              </div>
            )
          })}
        </div>

        {/* Entries Table */}
        {loading ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
            <div className="text-slate-600">Loading address book...</div>
          </div>
        ) : error ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
            <div className="text-red-600">{error}</div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-medium text-slate-700">Company</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-slate-700">Type</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-slate-700">Location</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-slate-700">Contact</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-slate-700">Business Info</th>
                    {canEdit && <th className="px-6 py-4 text-right text-sm font-medium text-slate-700">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredEntries.map((entry) => {
                    const typeInfo = ADDRESS_TYPES.find(t => t.value === entry.type)
                    return (
                      <tr key={entry.id} className="hover:bg-slate-50">
                        <td className="px-6 py-4">
                          <div>
                            <div className="font-medium text-slate-900">{entry.name}</div>
                            {entry.contactPerson && (
                              <div className="text-sm text-slate-600">Contact: {entry.contactPerson}</div>
                            )}
                            {entry.website && (
                              <div className="text-sm text-blue-600">{entry.website}</div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${typeInfo?.color || 'bg-gray-100 text-gray-800'}`}>
                            {typeInfo?.label || entry.type}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-slate-900">
                            {entry.address && <div>{entry.address}</div>}
                            {(entry.city || entry.state || entry.zipCode) && (
                              <div>{entry.city}{entry.city && entry.state ? ', ' : ''}{entry.state} {entry.zipCode}</div>
                            )}
                            <div className="text-slate-600">{entry.country}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm">
                            {entry.phone && (
                              <div className="flex items-center gap-1 text-slate-900">
                                <Phone className="w-3 h-3" />
                                {entry.phone}
                              </div>
                            )}
                            {entry.email && (
                              <div className="flex items-center gap-1 text-slate-900">
                                <Mail className="w-3 h-3" />
                                {entry.email}
                              </div>
                            )}
                            {entry.fax && (
                              <div className="text-slate-600">Fax: {entry.fax}</div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm">
                            {entry.mcNumber && <div className="text-slate-900">MC: {entry.mcNumber}</div>}
                            {entry.dotNumber && <div className="text-slate-900">DOT: {entry.dotNumber}</div>}
                            {entry.paymentTerms && <div className="text-slate-600">Terms: {entry.paymentTerms}</div>}
                            {entry.creditLimit > 0 && <div className="text-slate-600">Credit: ${entry.creditLimit.toFixed(2)}</div>}
                          </div>
                        </td>
                        {canEdit && (
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => {
                                  setEditingEntry(entry)
                                  setFormData(entry)
                                  setShowForm(true)
                                }}
                                className="text-slate-400 hover:text-slate-600"
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDelete(entry.id)}
                                className="text-red-400 hover:text-red-600"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            
            {filteredEntries.length === 0 && !loading && (
              <div className="p-12 text-center text-slate-500">
                <Building2 className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                <h3 className="text-lg font-medium mb-2">No entries found</h3>
                <p>Try adjusting your search criteria or filters.</p>
              </div>
            )}
          </div>
        )}

        {/* Pagination Controls for Large Datasets */}
        {pagination.total > pagination.limit && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 px-6 py-4 mt-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="text-sm text-slate-700">
                  Showing <span className="font-medium">{((currentPage - 1) * pagination.limit) + 1}</span> to{' '}
                  <span className="font-medium">{Math.min(currentPage * pagination.limit, pagination.total)}</span> of{' '}
                  <span className="font-medium">{pagination.total.toLocaleString()}</span> entries
                </div>
                <select
                  value={pagination.limit}
                  onChange={(e) => {
                    const newLimit = parseInt(e.target.value)
                    setPagination(prev => ({ ...prev, limit: newLimit }))
                    fetchEntries(1, newLimit)
                  }}
                  className="px-3 py-1 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                >
                  <option value={50}>50 per page</option>
                  <option value={100}>100 per page</option>
                  <option value={200}>200 per page</option>
                  <option value={500}>500 per page</option>
                  <option value={1000}>1000 per page</option>
                </select>
              </div>
              
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => fetchEntries(1, pagination.limit)}
                  disabled={currentPage === 1 || loading}
                  className={`px-3 py-2 text-sm rounded-md ${
                    currentPage === 1 
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                      : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  First
                </button>
                <button
                  onClick={() => fetchEntries(currentPage - 1, pagination.limit)}
                  disabled={currentPage === 1 || loading}
                  className={`px-3 py-2 text-sm rounded-md ${
                    currentPage === 1 
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                      : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Previous
                </button>
                
                <div className="flex items-center space-x-1">
                  {(() => {
                    const totalPages = Math.ceil(pagination.total / pagination.limit)
                    const showPages = []
                    const startPage = Math.max(1, currentPage - 2)
                    const endPage = Math.min(totalPages, currentPage + 2)
                    
                    for (let i = startPage; i <= endPage; i++) {
                      showPages.push(i)
                    }
                    
                    return showPages.map(page => (
                      <button
                        key={page}
                        onClick={() => fetchEntries(page, pagination.limit)}
                        disabled={loading}
                        className={`px-3 py-2 text-sm rounded-md ${
                          page === currentPage
                            ? 'bg-emerald-600 text-white'
                            : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {page}
                      </button>
                    ))
                  })()}
                </div>
                
                <button
                  onClick={() => fetchEntries(currentPage + 1, pagination.limit)}
                  disabled={!pagination.hasMore || loading}
                  className={`px-3 py-2 text-sm rounded-md ${
                    !pagination.hasMore 
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                      : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Next
                </button>
                <button
                  onClick={() => {
                    const totalPages = Math.ceil(pagination.total / pagination.limit)
                    fetchEntries(totalPages, pagination.limit)
                  }}
                  disabled={!pagination.hasMore || loading}
                  className={`px-3 py-2 text-sm rounded-md ${
                    !pagination.hasMore 
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                      : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Last
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Import CSV Modal */}
        {showImport && (
          <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black bg-opacity-50">
            <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full">
              <div className="flex items-center justify-between p-6 border-b border-slate-200">
                <h3 className="font-semibold text-lg">Import Address Book CSV</h3>
                <button
                  onClick={() => setShowImport(false)}
                  className="p-2 hover:bg-slate-100 rounded-xl"
                >
                  ×
                </button>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium text-slate-900 mb-2">CSV File Requirements</h4>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                      <ul className="list-disc list-inside space-y-1">
                        <li><strong>Required columns:</strong> Company, Type</li>
                        <li><strong>Optional columns:</strong> Address, City, State, ZipCode, Country, ContactPerson, Phone, Email, Fax, Website, TaxId, MCNumber, DOTNumber, CreditLimit, PaymentTerms, PreferredRate, Notes</li>
                        <li><strong>Type values:</strong> CUSTOMER, BROKER, SHIPPER, CONSIGNEE, VENDOR</li>
                        <li><strong>Format:</strong> CSV with headers in first row</li>
                      </ul>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Select CSV File
                    </label>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                      className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
                    />
                  </div>

                  {importFile && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <div className="text-sm text-green-800">
                        <strong>Selected:</strong> {importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={handleImport}
                      disabled={importing || !importFile}
                      className="btn"
                    >
                      {importing ? 'Importing...' : 'Import CSV'}
                    </button>
                    <button
                      onClick={() => setShowImport(false)}
                      disabled={importing}
                      className="btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Add/Edit Form Modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black bg-opacity-50">
            <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
              <div className="flex items-center justify-between p-6 border-b border-slate-200">
                <h3 className="font-semibold text-lg">
                  {editingEntry ? 'Edit Entry' : 'Add New Entry'}
                </h3>
                <button
                  onClick={() => setShowForm(false)}
                  className="p-2 hover:bg-slate-100 rounded-xl"
                >
                  ×
                </button>
              </div>
              <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
                <AddressBookEntryForm
                  data={formData}
                  onChange={setFormData}
                  onSave={handleSave}
                  onCancel={() => setShowForm(false)}
                  saving={saving}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Address Book Entry Form Component
function AddressBookEntryForm({ 
  data, 
  onChange, 
  onSave, 
  onCancel, 
  saving 
}: {
  data: Partial<AddressBookEntry>
  onChange: (data: Partial<AddressBookEntry>) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
}) {
  const handleChange = (field: keyof AddressBookEntry, value: any) => {
    onChange({ ...data, [field]: value })
  }

  return (
    <div className="space-y-6">
      {/* Basic Information */}
      <div>
        <h4 className="font-medium text-slate-900 mb-4">Basic Information</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Company Name *
            </label>
            <input
              type="text"
              value={data.name || ''}
              onChange={(e) => handleChange('name', e.target.value)}
              className="input"
              placeholder="Enter company name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Type *
            </label>
            <select
              value={data.type || 'CUSTOMER'}
              onChange={(e) => handleChange('type', e.target.value)}
              className="input"
            >
              {ADDRESS_TYPES.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Contact Person
            </label>
            <input
              type="text"
              value={data.contactPerson || ''}
              onChange={(e) => handleChange('contactPerson', e.target.value)}
              className="input"
              placeholder="Primary contact person"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Phone
            </label>
            <input
              type="tel"
              value={data.phone || ''}
              onChange={(e) => handleChange('phone', e.target.value)}
              className="input"
              placeholder="(555) 123-4567"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Email
            </label>
            <input
              type="email"
              value={data.email || ''}
              onChange={(e) => handleChange('email', e.target.value)}
              className="input"
              placeholder="contact@company.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Website
            </label>
            <input
              type="url"
              value={data.website || ''}
              onChange={(e) => handleChange('website', e.target.value)}
              className="input"
              placeholder="https://www.company.com"
            />
          </div>
        </div>
      </div>

      {/* Address Information */}
      <div>
        <h4 className="font-medium text-slate-900 mb-4">Address Information</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Street Address
            </label>
            <input
              type="text"
              value={data.address || ''}
              onChange={(e) => handleChange('address', e.target.value)}
              className="input"
              placeholder="123 Main Street"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              City
            </label>
            <input
              type="text"
              value={data.city || ''}
              onChange={(e) => handleChange('city', e.target.value)}
              className="input"
              placeholder="City"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              State
            </label>
            <input
              type="text"
              value={data.state || ''}
              onChange={(e) => handleChange('state', e.target.value)}
              className="input"
              placeholder="ST"
              maxLength={2}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Zip Code
            </label>
            <input
              type="text"
              value={data.zipCode || ''}
              onChange={(e) => handleChange('zipCode', e.target.value)}
              className="input"
              placeholder="12345"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Country
            </label>
            <input
              type="text"
              value={data.country || 'USA'}
              onChange={(e) => handleChange('country', e.target.value)}
              className="input"
            />
          </div>
        </div>
      </div>

      {/* Business Information */}
      <div>
        <h4 className="font-medium text-slate-900 mb-4">Business Information</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Tax ID / EIN
            </label>
            <input
              type="text"
              value={data.taxId || ''}
              onChange={(e) => handleChange('taxId', e.target.value)}
              className="input"
              placeholder="12-3456789"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              MC Number
            </label>
            <input
              type="text"
              value={data.mcNumber || ''}
              onChange={(e) => handleChange('mcNumber', e.target.value)}
              className="input"
              placeholder="MC-123456"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              DOT Number
            </label>
            <input
              type="text"
              value={data.dotNumber || ''}
              onChange={(e) => handleChange('dotNumber', e.target.value)}
              className="input"
              placeholder="DOT-789012"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Payment Terms
            </label>
            <select
              value={data.paymentTerms || ''}
              onChange={(e) => handleChange('paymentTerms', e.target.value)}
              className="input"
            >
              <option value="">Select terms</option>
              <option value="COD">COD (Cash on Delivery)</option>
              <option value="NET 15">NET 15</option>
              <option value="NET 30">NET 30</option>
              <option value="NET 45">NET 45</option>
              <option value="NET 60">NET 60</option>
              <option value="NET 90">NET 90</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Credit Limit ($)
            </label>
            <input
              type="number"
              step="0.01"
              value={data.creditLimit || 0}
              onChange={(e) => handleChange('creditLimit', parseFloat(e.target.value) || 0)}
              className="input"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Preferred Rate ($)
            </label>
            <input
              type="number"
              step="0.01"
              value={data.preferredRate || 0}
              onChange={(e) => handleChange('preferredRate', parseFloat(e.target.value) || 0)}
              className="input"
              placeholder="0.00"
            />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Notes
        </label>
        <textarea
          value={data.notes || ''}
          onChange={(e) => handleChange('notes', e.target.value)}
          className="input"
          rows={3}
          placeholder="Additional notes or comments..."
        />
      </div>

      {/* Form Actions */}
      <div className="flex gap-3 pt-4 border-t border-slate-200">
        <button
          onClick={onSave}
          disabled={saving || !data.name || !data.type}
          className="btn"
        >
          {saving ? 'Saving...' : 'Save Entry'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="btn-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}