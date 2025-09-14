import { prisma } from './prisma'

interface LoadData {
  customer: string
  customer2: string
  billTo: string
  pickupStreet: string
  pickupCity: string
  pickupState: string
  pickupZip: string
  dropStreet: string
  dropCity: string
  dropState: string
  dropZip: string
}

interface AddressBookAutoSaveResult {
  saved: string[]
  errors: string[]
}

/**
 * Automatically saves new customers to the Address Book
 * @param loadData - The load form data containing customer and address info
 * @returns Object with saved customers and any errors
 */
export async function autoSaveCustomersToAddressBook(loadData: LoadData): Promise<AddressBookAutoSaveResult> {
  const result: AddressBookAutoSaveResult = {
    saved: [],
    errors: []
  }

  try {
    // Helper function to check if customer exists and save if not
    const saveCustomerIfNew = async (
      customerName: string, 
      type: string, 
      address: string, 
      city: string, 
      state: string, 
      zipCode: string
    ) => {
      if (!customerName.trim()) return

      try {
        // Check if customer already exists (case insensitive)
        const existingCustomer = await prisma.addressBook.findFirst({
          where: {
            name: customerName.trim(),
            type: type
          }
        })

        if (!existingCustomer) {
          // Customer doesn't exist, create new entry
          const newCustomer = await prisma.addressBook.create({
            data: {
              name: customerName.trim(),
              type: type,
              address: address.trim() || null,
              city: city.trim() || null,
              state: state.trim() || null,
              zipCode: zipCode.trim() || null,
              country: 'USA',
              isActive: true,
              createdDate: new Date().toISOString(),
              modifiedDate: new Date().toISOString(),
              modifiedBy: 'auto-save'
            }
          })
          
          result.saved.push(`${customerName} (${type})`)
          console.log(`✅ Auto-saved customer: ${customerName} as ${type}`)
        }
      } catch (error) {
        const errorMsg = `Failed to save ${customerName}: ${error instanceof Error ? error.message : 'Unknown error'}`
        result.errors.push(errorMsg)
        console.error(`❌ Auto-save error for ${customerName}:`, error)
      }
    }

    // Auto-save pickup customer
    if (loadData.customer && loadData.customer.trim()) {
      await saveCustomerIfNew(
        loadData.customer,
        'CUSTOMER',
        loadData.pickupStreet || '',
        loadData.pickupCity || '',
        loadData.pickupState || '',
        loadData.pickupZip || ''
      )
    }

    // Auto-save drop customer (if different from pickup)
    if (loadData.customer2 && loadData.customer2.trim() && loadData.customer2 !== loadData.customer) {
      await saveCustomerIfNew(
        loadData.customer2,
        'CONSIGNEE',
        loadData.dropStreet || '',
        loadData.dropCity || '',
        loadData.dropState || '',
        loadData.dropZip || ''
      )
    }

    // Auto-save Bill To (if different from others)
    if (loadData.billTo && 
        loadData.billTo.trim() && 
        loadData.billTo !== loadData.customer && 
        loadData.billTo !== loadData.customer2) {
      await saveCustomerIfNew(
        loadData.billTo,
        'BROKER',
        '', // Bill To typically doesn't have address in load form
        '',
        '',
        ''
      )
    }

  } catch (error) {
    console.error('❌ Auto-save process failed:', error)
    result.errors.push(`Auto-save process failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  return result
}

/**
 * Check if a customer name exists in the Address Book
 * @param customerName - Name to check
 * @returns boolean indicating if customer exists
 */
export async function customerExistsInAddressBook(customerName: string): Promise<boolean> {
  if (!customerName.trim()) return false

  try {
    const existingCustomer = await prisma.addressBook.findFirst({
      where: {
        name: customerName.trim()
      }
    })
    
    return !!existingCustomer
  } catch (error) {
    console.error('Error checking customer existence:', error)
    return false
  }
}

