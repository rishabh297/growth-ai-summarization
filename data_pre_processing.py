import pandas as pd

import os

# Define your input and output paths
base_path = "/Users/rishabhgoel/Desktop/Harvard/Zak Lab/P3 Project/P3 Project Data/all"
parquet_files = [
    "labs.parquet",
    "medications.parquet",
    "patients.parquet",
    "problem_list.parquet",
    "referrals.parquet",
    "visits.parquet"
]

# Convert each .parquet file to .csv
for parquet_file in parquet_files:
    parquet_path = os.path.join(base_path, parquet_file)
    csv_path = parquet_path.replace(".parquet", ".csv")

    # Read and convert
    df = pd.read_parquet(parquet_path)
    df.to_csv(csv_path, index=False)

    print(f"Converted {parquet_file} to CSV.")


# Load all CSV files into dataframes
df_patients = pd.read_csv('/Users/rishabhgoel/Desktop/Harvard/Zak Lab/P3 Project/P3 Project Data/summarize/patients.csv')
df_visits = pd.read_csv('/Users/rishabhgoel/Desktop/Harvard/Zak Lab/P3 Project/P3 Project Data/summarize/visits.csv')
df_problem_list = pd.read_csv('/Users/rishabhgoel/Desktop/Harvard/Zak Lab/P3 Project/P3 Project Data/summarize/problem_list.csv')
df_medications = pd.read_csv('/Users/rishabhgoel/Desktop/Harvard/Zak Lab/P3 Project/P3 Project Data/summarize/medications.csv')
df_labs = pd.read_csv('/Users/rishabhgoel/Desktop/Harvard/Zak Lab/P3 Project/P3 Project Data/summarize/labs.csv')
df_referrals = pd.read_csv('/Users/rishabhgoel/Desktop/Harvard/Zak Lab/P3 Project/P3 Project Data/summarize/referrals.csv')


# Start with visits and merge with patient demographics
visits_merged = df_visits.merge(df_patients, on='patient_id', how='left')


df_problem_list['problem_info'] = df_problem_list.apply(
    lambda row: f"{row['pl_diag']} (noted: {row['noted_date_age_in_days']}, resolved: {row['resolved_date_age_in_days'] if pd.notnull(row['resolved_date_age_in_days']) else 'ongoing'})",
    axis=1
)

df_problem_agg = df_problem_list.groupby('patient_id')['problem_info'].apply(lambda x: '; '.join(x)).reset_index()
df_problem_agg = df_problem_agg.rename(columns={'problem_info': 'patient_problems'})

visits_merged = visits_merged.merge(df_problem_agg, on='patient_id', how='left')
# Step 5: Replace any NaN in the problem_inf column with an empty string
visits_merged['patient_problems'] = visits_merged['patient_problems'].fillna('')


#aggregating the medications
def format_medication(row):
    # Extract fields, handling missing values
    med_name = row['med_simple_generic_name']
    order_date = row['med_order_date_age_in_days'] if pd.notnull(row['med_order_date_age_in_days']) else 'unknown'
    start_date = row['med_start_date_age_in_days'] if pd.notnull(row['med_start_date_age_in_days']) else 'unknown'
    end_date = row['med_end_date_age_in_days'] if pd.notnull(row['med_end_date_age_in_days']) else 'ongoing'
    med_type = row['med_record_type']
    
    # Format into a single string
    return f"{med_name} (order: {order_date}, start: {start_date}, end: {end_date}, type: {med_type})"

# Apply the function to create a new column
df_medications['med_info'] = df_medications.apply(format_medication, axis=1)

df_medications_agg = df_medications.groupby('visit_id')['med_info'].apply(lambda x: '; '.join(x)).reset_index()
df_medications_agg = df_medications_agg.rename(columns={'med_info': 'medications_details'})

visits_merged = visits_merged.merge(df_medications_agg, on='visit_id', how='left')

# Step 5: Replace any NaN in the medications_details column with an empty string
visits_merged['medications_details'] = visits_merged['medications_details'].fillna('')


# Assuming df_labs is your lab data DataFrame and df_combined is your combined table
# df_labs should have columns: visit_id, lab_order_id, result_line_num, lab_order_date_age_in_days,
# lab_procedure_name, lab_procedure_description, lab_result_date_age_in_days, result_component_name,
# result_loinc_code, result_value, result_flag

# Step 1: Define a function to format each lab component
def format_lab_component(row):
    # Extract fields
    lab_order_id = row.get('lab_order_id', 'Unknown')  # Use 'Unknown' if lab_order_id isn’t available
    result_line_num = row['result_line_num']
    procedure_name = row['lab_procedure_name']
    description = row['lab_procedure_description']
    order_date = row['lab_order_date_age_in_days']
    result_date = row['lab_result_date_age_in_days'] if pd.notnull(row['lab_result_date_age_in_days']) else 'pending'
    component_name = row['result_component_name']
    loinc = row['result_loinc_code'] if pd.notnull(row['result_loinc_code']) else 'N/A'
    result_value = row['result_value']
    flag = 'normal' if row['result_flag'] == '(NONE)' else row['result_flag']
    
    # Format the string
    return (f"Lab Order {lab_order_id} (Line {result_line_num}): {procedure_name} - {description} - "
            f"{component_name}: {result_value} (flag: {flag}, LOINC: {loinc}, "
            f"order: {order_date}, result: {result_date})")

# Step 2: Apply the formatting function to each row
df_labs['lab_info'] = df_labs.apply(format_lab_component, axis=1)

# Step 3: Group by visit_id and join all lab info strings with "; "
df_labs_agg = df_labs.groupby('visit_id')['lab_info'].apply(lambda x: '; '.join(x)).reset_index()
df_labs_agg = df_labs_agg.rename(columns={'lab_info': 'labs_details'})

# Step 4: Merge into the combined table
visits_merged = visits_merged.merge(df_labs_agg, on='visit_id', how='left')

# Step 5: Fill missing labs_details with an empty string
visits_merged['labs_details'] = visits_merged['labs_details'].fillna('')



# Format each referral entry into a string
df_referrals['referral_info'] = df_referrals.apply(
    lambda row: f"{row['requested_specialty']} (date: {row['referral_date_age_in_days'] if pd.notnull(row['referral_date_age_in_days']) else 'unknown'}, visits: {row['referral_number_of_visits'] if pd.notnull(row['referral_number_of_visits']) else 'unknown'})",
    axis=1
)

# Aggregate referrals by visit_id, joining multiple referrals with "; "
df_referrals_agg = df_referrals.groupby('visit_id')['referral_info'].apply(lambda x: '; '.join(x)).reset_index()

# Rename the aggregated column for clarity
df_referrals_agg = df_referrals_agg.rename(columns={'referral_info': 'referrals_details'})

# Merge the aggregated data into the combined table using a left join
visits_merged = visits_merged.merge(df_referrals_agg, on='visit_id', how='left')

# Fill missing values in the new column with an empty string
visits_merged['referrals_details'] = visits_merged['referrals_details'].fillna('')

# Write the final combined dataframe to a CSV file.
visits_merged.to_csv("/Users/rishabhgoel/Desktop/Harvard/Zak Lab/P3 Project/P3 Project Data/summarize/combined_visits_aggregated_dec_summarize_2025.csv", index=False)

print(visits_merged)